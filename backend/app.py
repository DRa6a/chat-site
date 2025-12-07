import sqlite3

from flask import Flask, request, jsonify, render_template, send_from_directory
import json, pathlib, os
from datetime import datetime
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time
import uuid
import requests

app = Flask(__name__,
            template_folder='../frontend',
            static_folder='../frontend/static')
app.config['SECRET_KEY'] = 'your-secret-key'

# 初始化SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", logger=False, engineio_logger=False)

# 请求统计相关
class RequestStatistics:
    def __init__(self):
        self.stats = {}
        self.lock = threading.Lock()
        self.last_print_time = time.time()
        
    def record_request(self, endpoint, status_code):
        with self.lock:
            key = f"{endpoint}:{status_code}"
            if key not in self.stats:
                self.stats[key] = 0
            self.stats[key] += 1
            
            # 每30秒打印一次统计信息
            current_time = time.time()
            if current_time - self.last_print_time > 30:
                self.print_statistics()
                self.last_print_time = current_time
                
    def print_statistics(self):
        if self.stats:
            print("=== 请求统计 ===")
            for key, count in self.stats.items():
                print(f"  {key} - {count} 次")
            print("===============")
            # 重置统计
            self.stats.clear()

# 创建全局统计对象
request_stats = RequestStatistics()

# 自定义日志处理
import logging
from werkzeug.serving import WSGIRequestHandler

# 保存原始日志方法
original_log = WSGIRequestHandler.log

def custom_log(self, type, message, *args):
    # 只记录错误日志，忽略常规访问日志
    if type != 'info':
        original_log(self, type, message, *args)

# 应用自定义日志处理
WSGIRequestHandler.log = custom_log

ROOT = pathlib.Path(__file__).resolve().parent.parent
USER_FILE = ROOT / 'data' / 'users.json'
FRIENDS_DIR = ROOT / 'data' / 'users'
DB_FILE = ROOT / 'data' / 'chat.db'
UPLOAD_FOLDER = ROOT / 'uploads'
os.makedirs(FRIENDS_DIR, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# 在每个路由后记录统计信息
@app.after_request
def after_request(response):
    # 记录特定端点的请求统计（排除静态文件）
    if not request.path.startswith('/static'):
        request_stats.record_request(request.path, response.status_code)
    return response

def init_db():
    """初始化数据库"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 创建聊天记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    ''')
    
    # 创建好友关系表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS friendships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user1 TEXT NOT NULL,
            user2 TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    ''')
    
    # 创建已读消息标记表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS read_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL
        )
    ''')
    
    # 创建图片表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            uploader TEXT NOT NULL,
            upload_time TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

def load_users():
    with open(USER_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_users(users):
    with open(USER_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=4)

def load_chat_history(user1, user2):
    """加载两个用户之间的聊天记录"""
    # 首先尝试从数据库加载
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, sender, content, timestamp 
            FROM messages 
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
            ORDER BY timestamp ASC
        ''', (user1, user2, user2, user1))
        
        messages = []
        for row in cursor.fetchall():
            content = row[2]
            # 处理不同类型的消息前缀
            if content.startswith("Chat_"):
                content = content[5:]  # 去掉"Chat_"前缀
            # Pic_前缀保留，供前端识别处理
                
            messages.append({
                "id": row[0],
                "sender": row[1],
                "content": content,
                "timestamp": row[3]
            })
        
        conn.close()
        return messages
    except Exception as e:
        print(f"加载聊天历史时出错: {e}")
        return []

def save_chat_message(user1, user2, sender, content):
    """保存聊天消息"""
    # 保存到数据库，添加消息类型前缀
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 检查是否是图片消息 (Pic_前缀)
        if content.startswith("Pic_"):
            prefixed_content = content  # 已经带有前缀
        else:
            prefixed_content = "Chat_" + content  # 文字消息添加Chat_前缀
        
        cursor.execute('''
            INSERT INTO messages (sender, recipient, content, timestamp)
            VALUES (?, ?, ?, ?)
        ''', (sender, user2, prefixed_content, datetime.now().isoformat()))
        
        message_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        # 通过WebSocket通知相关用户有新消息
        room = "_".join(sorted([user1, user2]))
        # 去掉前缀发送实际内容
        display_content = content
        if content.startswith("Pic_"):
            # 图片消息保留Pic_前缀以便前端识别
            pass
        elif content.startswith("Chat_"):
            # 文字消息去掉Chat_前缀
            display_content = content[5:]
        
        socketio.emit('new_message', {
            'sender': sender,
            'recipient': user2,
            'content': display_content,
            'timestamp': datetime.now().isoformat()
        }, room=room)
        
        # 同时通知接收方首页更新未读消息数
        socketio.emit('unread_update', {'recipient': user2}, room=user2)
        
        # 通知发送方首页更新未读消息数（对于其他会话）
        socketio.emit('unread_update', {'recipient': sender}, room=sender)
        
        return message_id
    except Exception as e:
        print(f"保存到数据库时出错: {e}")
        return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login')
def login_page():
    return render_template('login.html')

@app.route('/chat/<friend>')
def chat_room(friend):
    return render_template('chat.html', friend=friend)

@app.route('/feedback')
def feedback():
    return render_template('feedback.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    users = load_users()
    u = request.json.get('username', '').strip()
    p = request.json.get('password', '')
    if users.get(u) == p:
        return jsonify({'ok': True, 'username': u, 'password': p})  # 返回用户名和密码
    return jsonify({'ok': False}), 401

@app.route('/api/friends')
def api_friends():
    u = request.args.get('u')
    if not u: return jsonify([]), 401
    f = FRIENDS_DIR / f"{u}.friends.json"
    if not f.exists():
        f.write_text(json.dumps([u]))
    return jsonify(json.loads(f.read_text()))

@app.route('/api/change-username', methods=['POST'])
def api_change_username():
    users = load_users()
    oldUsername = request.headers.get('X-User')
    newUsername = request.json.get('newUsername', '').strip()
    if oldUsername in users and newUsername not in users:
        users[newUsername] = users.pop(oldUsername)
        save_users(users)
        return jsonify({'ok': True})
    return jsonify({'ok': False}), 401

@app.route('/api/change-password', methods=['POST'])
def api_change_password():
    users = load_users()
    username = request.headers.get('X-User')
    newPassword = request.json.get('newPassword', '').strip()
    if username in users:
        users[username] = newPassword
        save_users(users)
        return jsonify({'ok': True})
    return jsonify({'ok': False}), 401

@app.route('/api/add-friend', methods=['POST'])
def api_add_friend():
    users = load_users()
    current_user = request.headers.get('X-User')
    friend_name = request.json.get('friendName', '').strip()

    # 验证当前用户是否存在
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401

    # 验证好友是否存在
    if friend_name not in users:
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404

    # 不能添加自己为好友
    if friend_name == current_user:
        return jsonify({'ok': False, 'msg': '不能添加自己为好友'}), 400

    # 读取当前用户的好友列表
    friend_file = FRIENDS_DIR / f"{current_user}.friends.json"
    if friend_file.exists():
        current_user_friends = json.loads(friend_file.read_text())
    else:
        current_user_friends = [current_user]

    # 读取被添加用户的好友列表
    friend_friend_file = FRIENDS_DIR / f"{friend_name}.friends.json"
    if friend_friend_file.exists():
        friend_friends = json.loads(friend_friend_file.read_text())
    else:
        # 新建好友列表时不包含自己
        friend_friends = []

    # 检查是否已经是好友（当前用户视角）
    if friend_name in current_user_friends:
        return jsonify({'ok': False, 'msg': '该用户已是好友'}), 400

    # 添加好友到当前用户列表
    current_user_friends.append(friend_name)
    friend_file.write_text(json.dumps(current_user_friends, ensure_ascii=False, indent=4))
    
    # 添加当前用户到好友列表（实现双向好友关系）
    if current_user not in friend_friends:
        friend_friends.append(current_user)
        friend_friend_file.write_text(json.dumps(friend_friends, ensure_ascii=False, indent=4))

    return jsonify({'ok': True, 'msg': '好友添加成功'})

@app.route('/api/remove-friend', methods=['POST'])
def api_remove_friend():
    """删除好友"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend_name = request.json.get('friendName', '').strip()

    # 验证当前用户是否存在
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401

    # 验证好友是否存在
    if friend_name not in users:
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404

    try:
        # 读取当前用户的好友列表
        friend_file = FRIENDS_DIR / f"{current_user}.friends.json"
        if friend_file.exists():
            current_user_friends = json.loads(friend_file.read_text())
        else:
            current_user_friends = [current_user]

        # 读取被删除用户的好友列表
        friend_friend_file = FRIENDS_DIR / f"{friend_name}.friends.json"
        if friend_friend_file.exists():
            friend_friends = json.loads(friend_friend_file.read_text())
        else:
            friend_friends = [friend_name]

        # 从当前用户好友列表中删除好友
        if friend_name in current_user_friends:
            current_user_friends.remove(friend_name)
            friend_file.write_text(json.dumps(current_user_friends, ensure_ascii=False, indent=4))

        # 从好友的好友列表中删除当前用户
        if current_user in friend_friends:
            friend_friends.remove(current_user)
            friend_friend_file.write_text(json.dumps(friend_friends, ensure_ascii=False, indent=4))

        return jsonify({'ok': True, 'msg': '好友删除成功'})
    except Exception as e:
        return jsonify({'ok': False, 'msg': '删除好友失败'}), 500

@app.route('/api/send-message', methods=['POST'])
def api_send_message():
    """发送消息API"""
    users = load_users()
    current_user = request.headers.get('X-User')
    recipient = request.json.get('recipient', '').strip()
    content = request.json.get('content', '').strip()
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if recipient not in users:
        return jsonify({'ok': False, 'msg': '接收用户不存在'}), 404
    
    if not content:
        return jsonify({'ok': False, 'msg': '消息内容不能为空'}), 400
    
    # 保存消息到数据库
    message_id = save_chat_message(current_user, recipient, current_user, content)
    
    if message_id:
        # 立即触发一次额外的未读消息检查，确保快速更新
        socketio.emit('unread_update', {'recipient': recipient}, room=recipient)
        socketio.emit('unread_update', {'recipient': current_user}, room=current_user)
        return jsonify({'ok': True, 'msg': '消息发送成功', 'message_id': message_id})
    else:
        return jsonify({'ok': False, 'msg': '消息发送失败'}), 500

@app.route('/api/chat-history')
def api_chat_history():
    """获取聊天历史API"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend = request.args.get('friend', '').strip()
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if friend not in users:
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404
    
    # 获取聊天历史
    history = load_chat_history(current_user, friend)
    return jsonify({'ok': True, 'history': history})

@app.route('/api/clear-chat-history', methods=['POST'])
def api_clear_chat_history():
    """清空聊天记录"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend_name = request.json.get('friendName', '').strip()

    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401

    if friend_name not in users:
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 先查找将要删除的图片消息，以便后续删除文件
        cursor.execute('''
            SELECT i.filename 
            FROM messages m
            JOIN images i ON i.id = CAST(SUBSTR(m.content, 5) AS INTEGER)
            WHERE ((m.sender = ? AND m.recipient = ?) OR (m.sender = ? AND m.recipient = ?))
            AND m.content LIKE 'Pic_%'
        ''', (current_user, friend_name, friend_name, current_user))
        
        image_files = cursor.fetchall()
        
        # 删除图片文件
        for (filename,) in image_files:
            file_path = UPLOAD_FOLDER / filename
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    print(f"删除图片文件失败 {file_path}: {e}")
        
        # 删除两个用户之间的所有消息记录
        cursor.execute('''
            DELETE FROM messages 
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
        ''', (current_user, friend_name, friend_name, current_user))
        
        # 删除与这些消息相关的已读标记
        cursor.execute('''
            DELETE FROM read_messages 
            WHERE message_id NOT IN (SELECT id FROM messages WHERE id IS NOT NULL)
        ''')
        
        # 删除与这些消息相关的图片记录
        cursor.execute('''
            DELETE FROM images 
            WHERE id NOT IN (SELECT CAST(SUBSTR(content, 5) AS INTEGER) FROM messages WHERE content LIKE 'Pic_%' AND id IS NOT NULL)
        ''')
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'msg': '聊天记录已清空'})
    except Exception as e:
        print(f"清空聊天记录失败: {e}")  # 添加详细的错误日志
        return jsonify({'ok': False, 'msg': f'清空聊天记录失败: {str(e)}'}), 500

@app.route('/api/unread-messages')
def api_unread_messages():
    """获取未读消息数量"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    unread_counts = {}
    
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 获取用户好友列表
        friend_file = FRIENDS_DIR / f"{current_user}.friends.json"
        if friend_file.exists():
            friends_list = json.loads(friend_file.read_text())
        else:
            friends_list = [current_user]
        
        # 检查每个好友的聊天记录，统计未读消息
        for friend in friends_list:
            if friend != current_user:  # 不统计自己
                # 查询来自好友且用户未读的消息数量
                cursor.execute('''
                    SELECT COUNT(*) 
                    FROM messages m
                    LEFT JOIN read_messages r ON m.id = r.message_id AND r.user = ?
                    WHERE m.sender = ? AND m.recipient = ? AND r.message_id IS NULL
                ''', (current_user, friend, current_user))
                
                count = cursor.fetchone()[0]
                unread_counts[friend] = count
        
        conn.close()
    except Exception as e:
        print(f"检查未读消息时出错: {e}")
        # 出错时返回空的未读消息计数
        for friend in friends_list:
            if friend != current_user:
                unread_counts[friend] = 0
    
    return jsonify({'ok': True, 'unread_counts': unread_counts})

@app.route('/api/mark-messages-as-read', methods=['POST'])
def api_mark_messages_as_read():
    """标记消息为已读"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend = request.json.get('friend', '').strip()
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if friend not in users:
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404
    
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 获取与好友之间的未读消息
        cursor.execute('''
            SELECT m.id
            FROM messages m
            LEFT JOIN read_messages r ON m.id = r.message_id AND r.user = ?
            WHERE m.sender = ? AND m.recipient = ? AND r.message_id IS NULL
        ''', (current_user, friend, current_user))
        
        unread_message_ids = cursor.fetchall()
        
        # 将未读消息标记为已读
        timestamp = datetime.now().isoformat()
        for (message_id,) in unread_message_ids:
            cursor.execute('''
                INSERT INTO read_messages (user, message_id, timestamp)
                VALUES (?, ?, ?)
            ''', (current_user, message_id, timestamp))
        
        conn.commit()
        conn.close()
        
        # 通知所有相关会话更新未读消息数
        socketio.emit('unread_update', {'recipient': current_user}, room=current_user)
        socketio.emit('unread_update', {'recipient': friend}, room=friend)
        
        return jsonify({'ok': True, 'marked_count': len(unread_message_ids)})
    except Exception as e:
        print(f"标记消息为已读时出错: {e}")
        return jsonify({'ok': False, 'msg': '标记消息为已读失败'}), 500

@app.route('/api/upload-image', methods=['POST'])
def upload_image():
    """上传图片API"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if 'image' not in request.files:
        return jsonify({'ok': False, 'msg': '没有上传文件'}), 400
    
    image_file = request.files['image']
    if image_file.filename == '':
        return jsonify({'ok': False, 'msg': '文件名为空'}), 400
    
    if image_file:
        try:
            # 生成唯一文件名
            ext = os.path.splitext(image_file.filename)[1]
            if not ext:
                ext = '.png'  # 默认扩展名
            unique_filename = str(uuid.uuid4()) + ext
            file_path = UPLOAD_FOLDER / unique_filename
            
            # 保存文件
            image_file.save(file_path)
            
            # 保存图片信息到数据库
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO images (filename, original_name, uploader, upload_time)
                VALUES (?, ?, ?, ?)
            ''', (unique_filename, image_file.filename, current_user, datetime.now().isoformat()))
            
            image_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            return jsonify({'ok': True, 'image_id': image_id, 'msg': '图片上传成功'})
        except Exception as e:
            # 如果保存数据库失败，删除已上传的文件
            if 'file_path' in locals() and os.path.exists(file_path):
                os.remove(file_path)
            print(f"保存图片信息到数据库时出错: {e}")
            return jsonify({'ok': False, 'msg': f'上传失败: {str(e)}'}), 500
    
    return jsonify({'ok': False, 'msg': '上传失败'}), 500

@app.route('/api/get-image/<int:image_id>')
def get_image(image_id):
    """获取图片"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute('SELECT filename FROM images WHERE id = ?', (image_id,))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            filename = result[0]
            file_path = UPLOAD_FOLDER / filename
            if os.path.exists(file_path):
                return send_from_directory(UPLOAD_FOLDER, filename)
        
        return jsonify({'ok': False, 'msg': '图片不存在'}), 404
    except Exception as e:
        print(f"获取图片时出错: {e}")
        return jsonify({'ok': False, 'msg': '获取图片失败'}), 500

@app.route('/api/music/search')
def music_search():
    """搜索音乐"""
    keyword = request.args.get('keyword', '')
    limit = request.args.get('limit', '30')
    
    if not keyword:
        return jsonify({'ok': False, 'msg': '搜索关键词不能为空'}), 400
    
    try:
        # 使用网易云音乐API搜索音乐
        url = 'https://music.163.com/api/cloudsearch/pc'
        params = {
            's': keyword,
            'type': '1',  # 1: 单曲
            'limit': limit,
            'offset': '0'
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://music.163.com'
        }
        
        response = requests.post(url, data=params, headers=headers)
        data = response.json()
        
        if data.get('code') == 200:
            songs = []
            for song in data.get('result', {}).get('songs', []):
                # 处理歌手信息
                artists = []
                for artist in song.get('ar', []):
                    artists.append(artist.get('name', ''))
                
                # 检查是否为VIP歌曲
                is_vip = False
                if 'privilege' in song:
                    # 如果有privilege字段，检查fee和payed字段
                    privilege = song['privilege']
                    fee = privilege.get('fee', 0)
                    payed = privilege.get('payed', 0)
                    # fee=1表示付费歌曲，payed=0表示未付费
                    if fee == 1 and payed == 0:
                        is_vip = True
                
                songs.append({
                    'id': song.get('id'),
                    'name': song.get('name'),
                    'artists': artists,
                    'album': song.get('al', {}).get('name', ''),
                    'picUrl': song.get('al', {}).get('picUrl', ''),
                    'isVip': is_vip  # 添加VIP标识
                })
            
            return jsonify({'ok': True, 'songs': songs})
        else:
            return jsonify({'ok': False, 'msg': '搜索失败'}), 500
    except Exception as e:
        print(f"音乐搜索出错: {e}")
        return jsonify({'ok': False, 'msg': f'搜索出错: {str(e)}'}), 500

@app.route('/api/music/detail')
def music_detail():
    """获取音乐详情"""
    music_id = request.args.get('id', '')
    
    if not music_id:
        return jsonify({'ok': False, 'msg': '音乐ID不能为空'}), 400
    
    try:
        # 使用网易云音乐API获取音乐详情
        url = f'https://music.163.com/api/song/detail'
        params = {
            'ids': f'[{music_id}]'
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://music.163.com'
        }
        
        response = requests.get(url, params=params, headers=headers)
        data = response.json()
        
        if data.get('code') == 200 and data.get('songs'):
            song = data['songs'][0]
            # 处理歌手信息
            artists = []
            for artist in song.get('artists', []):
                artists.append(artist.get('name', ''))
            
            music_info = {
                'id': song.get('id'),
                'name': song.get('name'),
                'artists': artists,
                'album': song.get('album', {}).get('name', ''),
                'picUrl': song.get('album', {}).get('picUrl', ''),
                'duration': song.get('duration', 0)
            }
            
            return jsonify({'ok': True, 'music': music_info})
        else:
            return jsonify({'ok': False, 'msg': '获取音乐详情失败'}), 500
    except Exception as e:
        print(f"获取音乐详情出错: {e}")
        return jsonify({'ok': False, 'msg': f'获取详情出错: {str(e)}'}), 500

@app.route('/api/music/url')
def music_url():
    """获取音乐播放链接"""
    music_id = request.args.get('id', '')
    
    if not music_id:
        return jsonify({'ok': False, 'msg': '音乐ID不能为空'}), 400
    
    try:
        # 使用网易云音乐API获取音乐播放链接
        url = f'https://music.163.com/song/media/outer/url?id={music_id}.mp3'
        return jsonify({'ok': True, 'url': url})
    except Exception as e:
        print(f"获取音乐播放链接出错: {e}")
        return jsonify({'ok': False, 'msg': f'获取播放链接出错: {str(e)}'}), 500

@app.route('/api/music/lyric')
def music_lyric():
    """获取音乐歌词"""
    music_id = request.args.get('id', '')
    
    if not music_id:
        return jsonify({'ok': False, 'msg': '音乐ID不能为空'}), 400
    
    try:
        # 使用网易云音乐API获取歌词
        url = f'https://music.163.com/api/song/lyric'
        params = {
            'id': music_id,
            'lv': -1,
            'kv': -1,
            'tv': -1
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://music.163.com'
        }
        
        response = requests.get(url, params=params, headers=headers)
        data = response.json()
        
        if data.get('code') == 200:
            lyric = data.get('lrc', {}).get('lyric', '')
            return jsonify({'ok': True, 'lyric': lyric})
        else:
            return jsonify({'ok': False, 'msg': '获取歌词失败'}), 500
    except Exception as e:
        print(f"获取歌词出错: {e}")
        return jsonify({'ok': False, 'msg': f'获取歌词出错: {str(e)}'}), 500

# 反馈系统相关接口
FEEDBACK_FILE = ROOT / 'data' / 'feedback.json'
OPS_FILE = ROOT / 'data' / 'ops.json'

def load_feedback():
    """加载反馈数据"""
    try:
        with open(FEEDBACK_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {"feedback": []}

def save_feedback(data):
    """保存反馈数据"""
    with open(FEEDBACK_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def load_ops():
    """加载管理员列表"""
    try:
        with open(OPS_FILE, 'r', encoding='utf-8') as f:
            return set(json.load(f))
    except FileNotFoundError:
        return set()

def is_op(user):
    """检查用户是否为管理员"""
    ops = load_ops()
    return user in ops

def generate_feedback_id(feedback_type, location, time_str):
    """生成反馈ID"""
    type_codes = {
        "bug": "CB",
        "suggestion": "CA",
        "plan": "CP"
    }
    
    type_code = type_codes.get(feedback_type, "CX")
    
    # 获取当前同位置的反馈数量，用于生成序号（不区分类型）
    feedback_data = load_feedback()
    count = 1
    for item in feedback_data["feedback"]:
        # 不再检查类型，只检查位置和日期
        if item["location"] == location and item["time"].startswith(time_str[:8]):
            count += 1
    
    # 格式化序号为4位数字
    serial_number = f"{count:04d}"
    
    return f"{type_code}-{location}-{time_str}-{serial_number}"

@app.route('/api/feedback/submit', methods=['POST'])
def submit_feedback():
    """提交反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    try:
        # 获取参数
        data = request.json
        feedback_type = data.get('type', '')
        location = data.get('location', '')
        content = data.get('content', '').strip()
    except Exception as e:
        return jsonify({'ok': False, 'msg': '请求数据格式错误'}), 400
    
    # 验证参数
    if not feedback_type or feedback_type not in ['bug', 'suggestion', 'plan']:
        return jsonify({'ok': False, 'msg': '反馈类型无效'}), 400
    
    if not location:
        return jsonify({'ok': False, 'msg': '反馈位置不能为空'}), 400
    
    if not content:
        return jsonify({'ok': False, 'msg': '反馈内容不能为空'}), 400
    
    # 检查权限：只有OP可以提交计划类型反馈
    if feedback_type == 'plan' and not is_op(current_user):
        return jsonify({'ok': False, 'msg': '只有管理员可以提交计划类型的反馈'}), 403
    
    # 生成时间戳
    now = datetime.now()
    time_str = now.strftime("%Y%m%d%H%M%S")
    
    # 生成反馈ID
    feedback_id = generate_feedback_id(feedback_type, location, time_str)
    
    # 创建反馈项
    feedback_item = {
        "id": feedback_id,
        "type": feedback_type,
        "location": location,
        "time": time_str,
        "content": content,
        "author": current_user,
        "upvotes": 0,
        "upvoted_by": []  # 点赞用户列表
    }
    
    # 保存反馈
    feedback_data = load_feedback()
    feedback_data["feedback"].append(feedback_item)
    save_feedback(feedback_data)
    
    return jsonify({'ok': True, 'msg': '反馈提交成功'})

@app.route('/api/feedback/list')
def list_feedback():
    """获取反馈列表"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 加载反馈数据
    feedback_data = load_feedback()
    feedback_list = feedback_data["feedback"]
    
    # 为每个反馈项添加用户是否已点赞的标记和OP标记
    for feedback in feedback_list:
        feedback["userUpvoted"] = current_user in feedback["upvoted_by"]
        feedback["isOP"] = is_op(current_user)
    
    return jsonify({'ok': True, 'feedback': feedback_list})

@app.route('/api/feedback/set-status', methods=['POST'])
def set_feedback_status():
    """设置反馈状态"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 检查权限：只有OP可以设置反馈状态
    if not is_op(current_user):
        return jsonify({'ok': False, 'msg': '只有管理员可以设置反馈状态'}), 403
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    status = request.json.get('status', '')
    note = request.json.get('note', '')
    
    if not feedback_id:
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 验证状态值
    valid_statuses = ['', 'completed', 'partial', 'alternative', 'impossible', 'failed']
    if status not in valid_statuses:
        return jsonify({'ok': False, 'msg': '无效的状态值'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    
    for item in feedback_data["feedback"]:
        if item["id"] == feedback_id:
            feedback_item = item
            break
    
    if not feedback_item:
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 更新状态和说明
    feedback_item["status"] = status
    feedback_item["statusNote"] = note
    
    # 保存数据
    save_feedback(feedback_data)
    
    return jsonify({'ok': True, 'msg': '状态更新成功'})

@app.route('/api/user/op-status', methods=['POST'])
def check_op_status():
    """检查用户是否为OP"""
    data = request.json
    username = data.get('username', '') if data else ''
    
    if not username:
        return jsonify({'ok': False, 'msg': '用户名不能为空'}), 400
    
    is_op_user = is_op(username)
    return jsonify({'ok': True, 'isOP': is_op_user})

@app.route('/api/feedback/upvote', methods=['POST'])
def upvote_feedback():
    """点赞反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    
    if not feedback_id:
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    for item in feedback_data["feedback"]:
        if item["id"] == feedback_id:
            feedback_item = item
            break
    
    if not feedback_item:
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 检查用户是否已经点赞
    if current_user in feedback_item["upvoted_by"]:
        return jsonify({'ok': False, 'msg': '您已经点赞过该反馈'}), 400
    
    # 添加点赞
    feedback_item["upvoted_by"].append(current_user)
    feedback_item["upvotes"] = len(feedback_item["upvoted_by"])
    
    # 保存数据
    save_feedback(feedback_data)
    
    return jsonify({'ok': True, 'upvotes': feedback_item["upvotes"]})

@app.route('/api/feedback/cancel-upvote', methods=['POST'])
def cancel_upvote_feedback():
    """取消点赞反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    
    if not feedback_id:
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    for item in feedback_data["feedback"]:
        if item["id"] == feedback_id:
            feedback_item = item
            break
    
    if not feedback_item:
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 检查用户是否已经点赞
    if current_user not in feedback_item["upvoted_by"]:
        return jsonify({'ok': False, 'msg': '您还没有点赞该反馈'}), 400
    
    # 取消点赞
    feedback_item["upvoted_by"].remove(current_user)
    feedback_item["upvotes"] = len(feedback_item["upvoted_by"])
    
    # 保存数据
    save_feedback(feedback_data)
    
    return jsonify({'ok': True, 'upvotes': feedback_item["upvotes"]})

@app.route('/api/feedback/delete', methods=['POST'])
def delete_feedback():
    """删除反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    
    if not feedback_id:
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    feedback_index = -1
    
    for i, item in enumerate(feedback_data["feedback"]):
        if item["id"] == feedback_id:
            feedback_item = item
            feedback_index = i
            break
    
    if not feedback_item:
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 检查权限：只有反馈发送者或OP可以删除反馈
    if feedback_item["author"] != current_user and not is_op(current_user):
        return jsonify({'ok': False, 'msg': '您没有权限删除该反馈'}), 403
    
    # 删除反馈
    del feedback_data["feedback"][feedback_index]
    
    # 保存数据
    save_feedback(feedback_data)
    
    return jsonify({'ok': True, 'msg': '反馈删除成功'})

@app.route('/flowStatistics')
def flow_statistics():
    """处理对/flowStatistics的请求，避免404日志"""
    return '', 204  # 返回204 No Content状态码

# WebSocket事件处理
@socketio.on('join')
def on_join(data):
    """用户加入房间"""
    username = data['username']
    friend = data['friend']
    room = "_".join(sorted([username, friend]))
    join_room(room)
    # 同时加入自己的房间，用于接收未读消息更新
    join_room(username)
    emit('status', {'msg': f'{username}加入了聊天室'})

@socketio.on('leave')
def on_leave(data):
    """用户离开房间"""
    username = data['username']
    friend = data['friend']
    room = "_".join(sorted([username, friend]))
    leave_room(room)
    leave_room(username)
    emit('status', {'msg': f'{username}离开了聊天室'})

@socketio.on('send_message')
def on_send_message(data):
    """通过WebSocket发送消息"""
    sender = data['sender']
    recipient = data['recipient']
    content = data['content']
    
    # 保存消息到数据库
    save_chat_message(sender, recipient, sender, content)

if __name__ == '__main__':
    # 初始化数据库
    init_db()
    # 启动服务器（包括WebSocket支持）
    socketio.run(app, host='0.0.0.0', port=80, debug=True, allow_unsafe_werkzeug=True)
    # app.run(host='0.0.0.0', port=80, debug=True)