import sqlite3

from flask import Flask, request, jsonify, render_template
import json, pathlib, os
from datetime import datetime
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time

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
os.makedirs(FRIENDS_DIR, exist_ok=True)

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
            messages.append({
                "id": row[0],
                "sender": row[1],
                "content": row[2],
                "timestamp": row[3]
            })
        
        conn.close()
        return messages
    except Exception as e:
        print(f"加载聊天历史时出错: {e}")
        return []

def save_chat_message(user1, user2, sender, content):
    """保存聊天消息"""
    # 保存到数据库
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO messages (sender, recipient, content, timestamp)
            VALUES (?, ?, ?, ?)
        ''', (sender, user2, content, datetime.now().isoformat()))
        
        message_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        # 通过WebSocket通知相关用户有新消息
        room = "_".join(sorted([user1, user2]))
        socketio.emit('new_message', {
            'sender': sender,
            'recipient': user2,
            'content': content,
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
        
        # 删除两个用户之间的所有消息记录
        cursor.execute('''
            DELETE FROM messages 
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
        ''', (current_user, friend_name, friend_name, current_user))
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'msg': '聊天记录已清空'})
    except Exception as e:
        return jsonify({'ok': False, 'msg': '清空聊天记录失败'}), 500

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