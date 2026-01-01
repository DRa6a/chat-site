import sqlite3

from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_wtf.csrf import CSRFProtect
import json, pathlib, os
from datetime import datetime
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time
import uuid
import requests
import bcrypt

# 添加日志模块
import logging
import sys

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

# 创建应用logger
logger = logging.getLogger('chat_app')

app = Flask(__name__,
            template_folder='../frontend',
            static_folder='../frontend/static')
# 使用环境变量管理SECRET_KEY，提供默认值
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')

# 初始化CSRF保护
csrf = CSRFProtect(app)

# 初始化SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", logger=False, engineio_logger=False)

# 移除了请求统计相关的代码

# 自定义日志处理
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

# 移除了 @app.after_request 装饰器函数，不再记录请求统计

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
    
    # 创建文件表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_type TEXT NOT NULL,
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

def hash_password(password):
    """使用bcrypt哈希密码"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(password, hashed_password):
    """验证密码是否匹配"""
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def migrate_passwords_to_hash():
    """迁移现有明文密码到哈希密码"""
    users = load_users()
    migrated = False
    
    for username, password in users.items():
        # 检查密码是否已经是哈希格式（bcrypt哈希以$2b$开头）
        if not password.startswith('$2b$'):
            users[username] = hash_password(password)
            migrated = True
            logger.info(f"已迁移用户 {username} 的密码到哈希格式")
    
    if migrated:
        save_users(users)
        logger.info("密码迁移完成")
    
    return migrated

def load_chat_history(user1, user2, limit=None, offset=0):
    """加载两个用户之间的聊天记录，支持分页"""
    # 首先尝试从数据库加载
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 构建基础查询
        query = '''
            SELECT id, sender, content, timestamp 
            FROM messages 
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
            ORDER BY timestamp ASC
        '''
        
        # 添加分页参数
        params = (user1, user2, user2, user1)
        if limit is not None:
            query += ' LIMIT ? OFFSET ?'
            params = params + (limit, offset)
        
        cursor.execute(query, params)
        
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
        logger.error(f"加载聊天历史时出错: {e}")
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
        
        # 记录消息发送日志
        logger.info(f"用户 {sender} 向 {user2} 发送消息: {display_content[:50]}{'...' if len(display_content) > 50 else ''}")
        
        return message_id
    except Exception as e:
        logger.error(f"保存到数据库时出错: {e}")
        return None

def add_friendship_db(user1, user2):
    """在数据库中添加好友关系"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 检查是否已经是好友
        cursor.execute('''
            SELECT COUNT(*) FROM friendships
            WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)
        ''', (user1, user2, user2, user1))
        
        if cursor.fetchone()[0] == 0:
            cursor.execute('''
                INSERT INTO friendships (user1, user2, timestamp)
                VALUES (?, ?, ?)
            ''', (user1, user2, datetime.now().isoformat()))
            conn.commit()
        
        conn.close()
        return True
    except Exception as e:
        logger.error(f"添加好友关系到数据库时出错: {e}")
        return False

def remove_friendship_db(user1, user2):
    """从数据库中删除好友关系"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute('''
            DELETE FROM friendships
            WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)
        ''', (user1, user2, user2, user1))
        
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logger.error(f"删除好友关系时出错: {e}")
        return False

def get_friends_db(user):
    """从数据库中获取用户的好友列表"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT CASE WHEN user1 = ? THEN user2 ELSE user1 END as friend
            FROM friendships
            WHERE user1 = ? OR user2 = ?
        ''', (user, user, user))
        
        friends = [row[0] for row in cursor.fetchall()]
        conn.close()
        return friends
    except Exception as e:
        logger.error(f"获取好友列表时出错: {e}")
        return []

@app.route('/')
def index():
    logger.info("访问主页")
    return render_template('index.html')

@app.route('/login')
def login_page():
    logger.info("访问登录页面")
    return render_template('login.html')

@app.route('/chat/<friend>')
def chat_room(friend):
    logger.info(f"访问与 {friend} 的聊天室")
    return render_template('chat.html', friend=friend)

@app.route('/feedback')
def feedback():
    logger.info("访问反馈页面")
    return render_template('feedback.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    users = load_users()
    u = request.json.get('username', '').strip()
    p = request.json.get('password', '')
    if u not in users:
        logger.warning(f"用户 {u} 登录失败：用户不存在")
        return jsonify({'ok': False}), 401
    
    stored_password = users[u]
    # 检查密码是否已经是哈希格式
    if stored_password.startswith('$2b$'):
        if verify_password(p, stored_password):
            logger.info(f"用户 {u} 登录成功")
            return jsonify({'ok': True, 'username': u})
        else:
            logger.warning(f"用户 {u} 登录失败：密码错误")
            return jsonify({'ok': False}), 401
    else:
        # 明文密码，用于向后兼容
        if users.get(u) == p:
            logger.info(f"用户 {u} 登录成功（明文密码）")
            return jsonify({'ok': True, 'username': u})
        logger.warning(f"用户 {u} 登录失败")
        return jsonify({'ok': False}), 401

@app.route('/api/friends')
def api_friends():
    u = request.args.get('u')
    if not u: 
        logger.warning("获取好友列表失败：用户未登录")
        return jsonify([]), 401
    
    # 首先尝试从数据库获取好友列表
    friends = get_friends_db(u)
    
    # 如果数据库中没有好友，尝试从JSON文件迁移
    if not friends:
        f = FRIENDS_DIR / f"{u}.friends.json"
        if f.exists():
            old_friends = json.loads(f.read_text())
            # 迁移到数据库
            for friend in old_friends:
                if friend != u:  # 不添加自己
                    add_friendship_db(u, friend)
            friends = get_friends_db(u)
    
    # 如果仍然没有好友，至少返回自己
    if not friends:
        friends = [u]
    
    logger.info(f"用户 {u} 获取好友列表")
    return jsonify(friends)

@app.route('/api/change-username', methods=['POST'])
def api_change_username():
    users = load_users()
    oldUsername = request.headers.get('X-User')
    newUsername = request.json.get('newUsername', '').strip()
    if oldUsername in users and newUsername not in users:
        users[newUsername] = users.pop(oldUsername)
        save_users(users)
        logger.info(f"用户 {oldUsername} 更改用户名为 {newUsername}")
        return jsonify({'ok': True})
    logger.warning(f"用户 {oldUsername} 更改用户名失败")
    return jsonify({'ok': False}), 401

@app.route('/api/change-password', methods=['POST'])
def api_change_password():
    users = load_users()
    username = request.headers.get('X-User')
    newPassword = request.json.get('newPassword', '').strip()
    if username in users:
        # 使用哈希存储新密码
        users[username] = hash_password(newPassword)
        save_users(users)
        logger.info(f"用户 {username} 更改密码成功")
        return jsonify({'ok': True})
    logger.warning(f"用户 {username} 更改密码失败")
    return jsonify({'ok': False}), 401

@app.route('/api/add-friend', methods=['POST'])
def api_add_friend():
    users = load_users()
    current_user = request.headers.get('X-User')
    friend_name = request.json.get('friendName', '').strip()

    # 验证当前用户是否存在
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法添加好友")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401

    # 验证好友是否存在
    if friend_name not in users:
        logger.warning(f"用户 {current_user} 尝试添加不存在的用户 {friend_name} 为好友")
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404

    # 不能添加自己为好友
    if friend_name == current_user:
        logger.warning(f"用户 {current_user} 尝试添加自己为好友")
        return jsonify({'ok': False, 'msg': '不能添加自己为好友'}), 400

    # 检查是否已经是好友
    current_friends = get_friends_db(current_user)
    if friend_name in current_friends:
        logger.warning(f"用户 {current_user} 和 {friend_name} 已经是好友")
        return jsonify({'ok': False, 'msg': '该用户已是好友'}), 400

    # 添加好友关系到数据库（双向）
    if add_friendship_db(current_user, friend_name):
        logger.info(f"用户 {current_user} 成功添加 {friend_name} 为好友")
        return jsonify({'ok': True, 'msg': '好友添加成功'})
    else:
        logger.error(f"用户 {current_user} 添加 {friend_name} 为好友失败")
        return jsonify({'ok': False, 'msg': '添加好友失败'}), 500

@app.route('/api/remove-friend', methods=['POST'])
def api_remove_friend():
    """删除好友"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend_name = request.json.get('friendName', '').strip()

    # 验证当前用户是否存在
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法删除好友")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401

    # 验证好友是否存在
    if friend_name not in users:
        logger.warning(f"用户 {current_user} 尝试删除不存在的用户 {friend_name}")
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404

    # 从数据库中删除好友关系（双向）
    if remove_friendship_db(current_user, friend_name):
        logger.info(f"用户 {current_user} 成功删除好友 {friend_name}")
        return jsonify({'ok': True, 'msg': '好友删除成功'})
    else:
        logger.error(f"用户 {current_user} 删除好友 {friend_name} 失败")
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
        logger.warning(f"用户 {current_user} 未登录，无法发送消息")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if recipient not in users:
        logger.warning(f"用户 {current_user} 尝试向不存在的用户 {recipient} 发送消息")
        return jsonify({'ok': False, 'msg': '接收用户不存在'}), 404
    
    if not content:
        logger.warning(f"用户 {current_user} 尝试发送空消息")
        return jsonify({'ok': False, 'msg': '消息内容不能为空'}), 400
    
    # 保存消息到数据库
    message_id = save_chat_message(current_user, recipient, current_user, content)
    
    if message_id:
        # 立即触发一次额外的未读消息检查，确保快速更新
        socketio.emit('unread_update', {'recipient': recipient}, room=recipient)
        socketio.emit('unread_update', {'recipient': current_user}, room=current_user)
        return jsonify({'ok': True, 'msg': '消息发送成功', 'message_id': message_id})
    else:
        logger.error(f"用户 {current_user} 发送消息失败")
        return jsonify({'ok': False, 'msg': '消息发送失败'}), 500

@app.route('/api/chat-history')
def api_chat_history():
    """获取聊天历史API，支持分页"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend = request.args.get('friend', '').strip()
    
    # 获取分页参数
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', 0, type=int)
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法获取聊天历史")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if friend not in users:
        logger.warning(f"用户 {current_user} 尝试获取与不存在的用户 {friend} 的聊天历史")
        return jsonify({'ok': False, 'msg': '用户不存在'}), 404
    
    # 获取聊天历史
    history = load_chat_history(current_user, friend, limit=limit, offset=offset)
    logger.info(f"用户 {current_user} 获取与 {friend} 的聊天历史，共 {len(history)} 条消息")
    return jsonify({'ok': True, 'history': history})

@app.route('/api/clear-chat-history', methods=['POST'])
def api_clear_chat_history():
    """清空聊天记录"""
    users = load_users()
    current_user = request.headers.get('X-User')
    friend_name = request.json.get('friendName', '').strip()

    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法清空聊天记录")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401

    if friend_name not in users:
        logger.warning(f"用户 {current_user} 尝试清空与不存在的用户 {friend_name} 的聊天记录")
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
                    logger.info(f"删除图片文件: {file_path}")
                except Exception as e:
                    logger.error(f"删除图片文件失败 {file_path}: {e}")
        
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
        
        logger.info(f"用户 {current_user} 清空与 {friend_name} 的聊天记录")
        return jsonify({'ok': True, 'msg': '聊天记录已清空'})
    except Exception as e:
        logger.error(f"清空聊天记录失败: {e}")  # 添加详细的错误日志
        return jsonify({'ok': False, 'msg': f'清空聊天记录失败: {str(e)}'}), 500

@app.route('/api/unread-messages')
def api_unread_messages():
    """获取未读消息数量，使用单条SQL查询优化性能"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法获取未读消息")
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
        
        # 使用单条SQL查询所有好友的未读消息数
        if friends_list:
            # 构建好友列表占位符
            placeholders = ','.join(['?' for _ in friends_list])
            
            # 查询来自所有好友且用户未读的消息数量
            cursor.execute(f'''
                SELECT m.sender, COUNT(*) as unread_count
                FROM messages m
                LEFT JOIN read_messages r ON m.id = r.message_id AND r.user = ?
                WHERE m.sender IN ({placeholders}) 
                  AND m.recipient = ? 
                  AND r.message_id IS NULL
                GROUP BY m.sender
            ''', [current_user] + friends_list + [current_user])
            
            # 将查询结果转换为字典
            for sender, count in cursor.fetchall():
                if sender != current_user:  # 不统计自己
                    unread_counts[sender] = count
            
            # 确保所有好友都有未读数（即使为0）
            for friend in friends_list:
                if friend != current_user and friend not in unread_counts:
                    unread_counts[friend] = 0
        
        conn.close()
        logger.info(f"用户 {current_user} 获取未读消息统计")
    except Exception as e:
        logger.error(f"检查未读消息时出错: {e}")
        # 出错时返回空的未读消息计数
        for friend in friends_list:
            if friend != current_user:
                unread_counts[friend] = 0
    
    return jsonify({'ok': True, 'unread_counts': unread_counts})

@app.route('/api/mark-messages-as-read', methods=['POST'])
def api_mark_messages_as_read():
    """标记消息为已读"""
    users = load_users()
    
    # 优先从请求头获取用户信息
    current_user = request.headers.get('X-User')
    
    # 如果请求头中没有，尝试从请求体中获取（用于sendBeacon请求）
    if not current_user:
        try:
            current_user = request.json.get('user', '').strip()
        except:
            pass
    
    friend = request.json.get('friend', '').strip()
    
    # 验证用户
    if not current_user or current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法标记消息为已读")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if not friend or friend not in users:
        logger.warning(f"用户 {current_user} 尝试标记与不存在的用户 {friend} 的消息为已读")
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
        marked_count = 0
        for (message_id,) in unread_message_ids:
            try:
                cursor.execute('''
                    INSERT INTO read_messages (user, message_id, timestamp)
                    VALUES (?, ?, ?)
                ''', (current_user, message_id, timestamp))
                marked_count += 1
            except sqlite3.IntegrityError:
                # 消息已经被标记为已读，跳过
                pass
        
        conn.commit()
        conn.close()
        
        # 通知所有相关会话更新未读消息数（仅在房间有成员时发送）
        try:
            socketio.emit('unread_update', {'recipient': current_user}, room=current_user)
        except Exception as e:
            logger.warning(f"发送未读消息更新通知失败 (current_user): {e}")
        
        try:
            socketio.emit('unread_update', {'recipient': friend}, room=friend)
        except Exception as e:
            logger.warning(f"发送未读消息更新通知失败 (friend): {e}")
        
        logger.info(f"用户 {current_user} 标记与 {friend} 的 {marked_count} 条消息为已读")
        return jsonify({'ok': True, 'marked_count': marked_count})
    except Exception as e:
        logger.error(f"标记消息为已读时出错: {e}", exc_info=True)
        return jsonify({'ok': False, 'msg': '标记消息为已读失败'}), 500

@app.route('/api/upload-image', methods=['POST'])
def upload_image():
    """上传图片API"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法上传图片")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if 'image' not in request.files:
        logger.warning(f"用户 {current_user} 上传图片失败：没有上传文件")
        return jsonify({'ok': False, 'msg': '没有上传文件'}), 400
    
    image_file = request.files['image']
    if image_file.filename == '':
        logger.warning(f"用户 {current_user} 上传图片失败：文件名为空")
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
            
            logger.info(f"用户 {current_user} 上传图片成功: {image_file.filename}")
            return jsonify({'ok': True, 'image_id': image_id, 'msg': '图片上传成功'})
        except Exception as e:
            # 如果保存数据库失败，删除已上传的文件
            if 'file_path' in locals() and os.path.exists(file_path):
                os.remove(file_path)
            logger.error(f"保存图片信息到数据库时出错: {e}")
            return jsonify({'ok': False, 'msg': f'上传失败: {str(e)}'}), 500
    
    logger.warning(f"用户 {current_user} 上传图片失败")
    return jsonify({'ok': False, 'msg': '上传失败'}), 500

@app.route('/api/upload-file', methods=['POST'])
def upload_file():
    """上传文件API"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法上传文件")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    if 'file' not in request.files:
        logger.warning(f"用户 {current_user} 上传文件失败：没有上传文件")
        return jsonify({'ok': False, 'msg': '没有上传文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        logger.warning(f"用户 {current_user} 上传文件失败：文件名为空")
        return jsonify({'ok': False, 'msg': '文件名为空'}), 400
    
    if file:
        try:
            # 生成唯一文件名
            ext = os.path.splitext(file.filename)[1]
            if not ext:
                ext = '.bin'  # 默认扩展名
            unique_filename = str(uuid.uuid4()) + ext
            file_path = UPLOAD_FOLDER / unique_filename
            
            # 保存文件
            file.save(file_path)
            
            # 获取文件大小
            file_size = os.path.getsize(file_path)
            
            # 保存文件信息到数据库
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO files (filename, original_name, file_size, file_type, uploader, upload_time)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (unique_filename, file.filename, file_size, ext.lower()[1:], current_user, datetime.now().isoformat()))
            
            file_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            logger.info(f"用户 {current_user} 上传文件成功: {file.filename} ({file_size} bytes)")
            return jsonify({'ok': True, 'file_id': file_id, 'msg': '文件上传成功'})
        except Exception as e:
            # 如果保存数据库失败，删除已上传的文件
            if 'file_path' in locals() and os.path.exists(file_path):
                os.remove(file_path)
            logger.error(f"保存文件信息到数据库时出错: {e}")
            return jsonify({'ok': False, 'msg': f'上传失败: {str(e)}'}), 500
    
    logger.warning(f"用户 {current_user} 上传文件失败")
    return jsonify({'ok': False, 'msg': '上传失败'}), 500

@app.route('/api/get-image/<int:image_id>')
def get_image(image_id):
    """获取图片"""
    try:
        # 验证用户是否已登录（仅使用HTTP Header验证）
        users = load_users()
        current_user = request.headers.get('X-User')
        if not current_user or current_user not in users:
            logger.warning(f"用户未登录，无法获取图片 {image_id}")
            return jsonify({'ok': False, 'msg': '用户未登录'}), 401
            
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 获取图片信息，包括上传者
        cursor.execute('SELECT filename, uploader FROM images WHERE id = ?', (image_id,))
        result = cursor.fetchone()
        
        if result:
            filename, uploader = result
            # 检查当前用户是否有权限访问这张图片
            # 用户可以访问自己上传的图片，或者与自己有聊天记录的图片
            if current_user == uploader or is_user_involved_in_image_chat(current_user, image_id):
                file_path = UPLOAD_FOLDER / filename
                if os.path.exists(file_path):
                    conn.close()
                    logger.info(f"用户 {current_user} 获取图片 {image_id}")
                    return send_from_directory(UPLOAD_FOLDER, filename)
            
            conn.close()
            logger.warning(f"用户 {current_user} 无权限查看图片 {image_id}")
            return jsonify({'ok': False, 'msg': '您没有权限查看此图片'}), 403
        
        conn.close()
        logger.warning(f"用户 {current_user} 尝试获取不存在的图片 {image_id}")
        return jsonify({'ok': False, 'msg': '图片不存在'}), 404
    except Exception as e:
        logger.error(f"获取图片时出错: {e}")
        return jsonify({'ok': False, 'msg': '获取图片失败'}), 500

@app.route('/api/get-file/<int:file_id>')
def get_file(file_id):
    """获取文件"""
    try:
        # 验证用户是否已登录（仅使用HTTP Header验证）
        users = load_users()
        current_user = request.headers.get('X-User')
        if not current_user or current_user not in users:
            logger.warning(f"用户未登录，无法获取文件 {file_id}")
            return jsonify({'ok': False, 'msg': '用户未登录'}), 401
            
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 获取文件信息，包括上传者
        cursor.execute('SELECT filename, uploader FROM files WHERE id = ?', (file_id,))
        result = cursor.fetchone()
        
        if result:
            filename, uploader = result
            # 检查当前用户是否有权限访问这个文件
            # 用户可以访问自己上传的文件，或者与自己有聊天记录的文件
            if current_user == uploader or is_user_involved_in_file_chat(current_user, file_id):
                file_path = UPLOAD_FOLDER / filename
                if os.path.exists(file_path):
                    conn.close()
                    logger.info(f"用户 {current_user} 获取文件 {file_id}")
                    return send_from_directory(UPLOAD_FOLDER, filename)
            
            conn.close()
            logger.warning(f"用户 {current_user} 无权限查看文件 {file_id}")
            return jsonify({'ok': False, 'msg': '您没有权限查看此文件'}), 403
        
        conn.close()
        logger.warning(f"用户 {current_user} 尝试获取不存在的文件 {file_id}")
        return jsonify({'ok': False, 'msg': '文件不存在'}), 404
    except Exception as e:
        logger.error(f"获取文件时出错: {e}")
        return jsonify({'ok': False, 'msg': '获取文件失败'}), 500

@app.route('/api/get-file-info/<int:file_id>')
def get_file_info(file_id):
    """获取文件信息"""
    try:
        # 验证用户是否已登录（仅使用HTTP Header验证）
        users = load_users()
        current_user = request.headers.get('X-User')
        if not current_user or current_user not in users:
            logger.warning(f"用户未登录，无法获取文件信息 {file_id}")
            return jsonify({'ok': False, 'msg': '用户未登录'}), 401
            
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 获取文件信息
        cursor.execute('SELECT filename, original_name, file_size, file_type, uploader, upload_time FROM files WHERE id = ?', (file_id,))
        result = cursor.fetchone()
        
        if result:
            filename, original_name, file_size, file_type, uploader, upload_time = result
            
            # 检查当前用户是否有权限访问这个文件
            # 用户可以访问自己上传的文件，或者与自己有聊天记录的文件
            if current_user == uploader or is_user_involved_in_file_chat(current_user, file_id):
                conn.close()
                
                file_info = {
                    'id': file_id,
                    'filename': filename,
                    'original_name': original_name,
                    'file_size': file_size,
                    'file_type': file_type,
                    'uploader': uploader,
                    'upload_time': upload_time
                }
                
                logger.info(f"用户 {current_user} 获取文件信息 {file_id}")
                return jsonify({'ok': True, 'file': file_info})
            
            conn.close()
            logger.warning(f"用户 {current_user} 无权限查看文件信息 {file_id}")
            return jsonify({'ok': False, 'msg': '您没有权限查看此文件信息'}), 403
        
        conn.close()
        logger.warning(f"用户 {current_user} 尝试获取不存在的文件信息 {file_id}")
        return jsonify({'ok': False, 'msg': '文件不存在'}), 404
    except Exception as e:
        logger.error(f"获取文件信息时出错: {e}")
        return jsonify({'ok': False, 'msg': '获取文件信息失败'}), 500

@app.route('/api/music/search')
def music_search():
    """搜索音乐"""
    keyword = request.args.get('keyword', '')
    limit = request.args.get('limit', '30')
    
    if not keyword:
        logger.warning("音乐搜索失败：关键词为空")
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
            
            logger.info(f"音乐搜索成功：关键词 '{keyword}'，返回 {len(songs)} 首歌曲")
            return jsonify({'ok': True, 'songs': songs})
        else:
            logger.error(f"音乐搜索失败：API返回错误码 {data.get('code')}")
            return jsonify({'ok': False, 'msg': '搜索失败'}), 500
    except Exception as e:
        logger.error(f"音乐搜索出错: {e}")
        return jsonify({'ok': False, 'msg': f'搜索出错: {str(e)}'}), 500

@app.route('/api/music/detail')
def music_detail():
    """获取音乐详情"""
    music_id = request.args.get('id', '')
    
    if not music_id:
        logger.warning("获取音乐详情失败：音乐ID为空")
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
            
            logger.info(f"获取音乐详情成功：音乐ID {music_id}")
            return jsonify({'ok': True, 'music': music_info})
        else:
            logger.error(f"获取音乐详情失败：API返回错误码 {data.get('code')}")
            return jsonify({'ok': False, 'msg': '获取音乐详情失败'}), 500
    except Exception as e:
        logger.error(f"获取音乐详情出错: {e}")
        return jsonify({'ok': False, 'msg': f'获取详情出错: {str(e)}'}), 500

@app.route('/api/music/url')
def music_url():
    """获取音乐播放链接"""
    music_id = request.args.get('id', '')
    
    if not music_id:
        logger.warning("获取音乐播放链接失败：音乐ID为空")
        return jsonify({'ok': False, 'msg': '音乐ID不能为空'}), 400
    
    try:
        # 使用网易云音乐API获取音乐播放链接
        url = f'https://music.163.com/song/media/outer/url?id={music_id}.mp3'
        logger.info(f"获取音乐播放链接成功：音乐ID {music_id}")
        return jsonify({'ok': True, 'url': url})
    except Exception as e:
        logger.error(f"获取音乐播放链接出错: {e}")
        return jsonify({'ok': False, 'msg': f'获取播放链接出错: {str(e)}'}), 500

@app.route('/api/music/lyric')
def music_lyric():
    """获取音乐歌词"""
    music_id = request.args.get('id', '')
    
    if not music_id:
        logger.warning("获取音乐歌词失败：音乐ID为空")
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
            logger.info(f"获取音乐歌词成功：音乐ID {music_id}")
            return jsonify({'ok': True, 'lyric': lyric})
        else:
            logger.error(f"获取歌词失败：API返回错误码 {data.get('code')}")
            return jsonify({'ok': False, 'msg': '获取歌词失败'}), 500
    except Exception as e:
        logger.error(f"获取歌词出错: {e}")
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
        logger.warning(f"用户 {current_user} 未登录，无法提交反馈")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    try:
        # 获取参数
        data = request.json
        feedback_type = data.get('type', '')
        location = data.get('location', '')
        content = data.get('content', '').strip()
    except Exception as e:
        logger.error(f"提交反馈时解析请求数据出错: {e}")
        return jsonify({'ok': False, 'msg': '请求数据格式错误'}), 400
    
    # 验证参数
    if not feedback_type or feedback_type not in ['bug', 'suggestion', 'plan']:
        logger.warning(f"用户 {current_user} 提交反馈失败：反馈类型无效")
        return jsonify({'ok': False, 'msg': '反馈类型无效'}), 400
    
    if not location:
        logger.warning(f"用户 {current_user} 提交反馈失败：反馈位置为空")
        return jsonify({'ok': False, 'msg': '反馈位置不能为空'}), 400
    
    if not content:
        logger.warning(f"用户 {current_user} 提交反馈失败：反馈内容为空")
        return jsonify({'ok': False, 'msg': '反馈内容不能为空'}), 400
    
    # 检查权限：只有OP可以提交计划类型反馈
    if feedback_type == 'plan' and not is_op(current_user):
        logger.warning(f"用户 {current_user} 无权限提交计划类型反馈")
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
    
    logger.info(f"用户 {current_user} 提交反馈成功：类型 {feedback_type}，位置 {location}")
    return jsonify({'ok': True, 'msg': '反馈提交成功'})

@app.route('/api/feedback/list')
def list_feedback():
    """获取反馈列表"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法获取反馈列表")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 加载反馈数据
    feedback_data = load_feedback()
    feedback_list = feedback_data["feedback"]
    
    # 为每个反馈项添加用户是否已点赞的标记和OP标记
    for feedback in feedback_list:
        feedback["userUpvoted"] = current_user in feedback["upvoted_by"]
        feedback["isOP"] = is_op(current_user)
    
    logger.info(f"用户 {current_user} 获取反馈列表，共 {len(feedback_list)} 条反馈")
    return jsonify({'ok': True, 'feedback': feedback_list})

@app.route('/api/feedback/set-status', methods=['POST'])
def set_feedback_status():
    """设置反馈状态"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法设置反馈状态")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 检查权限：只有OP可以设置反馈状态
    if not is_op(current_user):
        logger.warning(f"用户 {current_user} 无权限设置反馈状态")
        return jsonify({'ok': False, 'msg': '只有管理员可以设置反馈状态'}), 403
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    status = request.json.get('status', '')
    note = request.json.get('note', '')
    
    if not feedback_id:
        logger.warning(f"用户 {current_user} 设置反馈状态失败：反馈ID为空")
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 验证状态值
    valid_statuses = ['', 'completed', 'partial', 'alternative', 'impossible', 'failed']
    if status not in valid_statuses:
        logger.warning(f"用户 {current_user} 设置反馈状态失败：无效的状态值")
        return jsonify({'ok': False, 'msg': '无效的状态值'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    
    for item in feedback_data["feedback"]:
        if item["id"] == feedback_id:
            feedback_item = item
            break
    
    if not feedback_item:
        logger.warning(f"用户 {current_user} 设置反馈状态失败：反馈不存在")
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 更新状态和说明
    feedback_item["status"] = status
    feedback_item["statusNote"] = note
    
    # 保存数据
    save_feedback(feedback_data)
    
    logger.info(f"用户 {current_user} 设置反馈 {feedback_id} 状态为 {status}")
    return jsonify({'ok': True, 'msg': '状态更新成功'})

@app.route('/api/user/op-status', methods=['POST'])
def check_op_status():
    """检查用户是否为OP"""
    data = request.json
    username = data.get('username', '') if data else ''
    
    if not username:
        logger.warning("检查OP状态失败：用户名为空")
        return jsonify({'ok': False, 'msg': '用户名不能为空'}), 400
    
    is_op_user = is_op(username)
    logger.info(f"检查用户 {username} 是否为OP: {is_op_user}")
    return jsonify({'ok': True, 'isOP': is_op_user})

@app.route('/api/feedback/upvote', methods=['POST'])
def upvote_feedback():
    """点赞反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法点赞反馈")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    
    if not feedback_id:
        logger.warning(f"用户 {current_user} 点赞反馈失败：反馈ID为空")
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    for item in feedback_data["feedback"]:
        if item["id"] == feedback_id:
            feedback_item = item
            break
    
    if not feedback_item:
        logger.warning(f"用户 {current_user} 点赞反馈失败：反馈不存在")
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 检查用户是否已经点赞
    if current_user in feedback_item["upvoted_by"]:
        logger.warning(f"用户 {current_user} 已经点赞过反馈 {feedback_id}")
        return jsonify({'ok': False, 'msg': '您已经点赞过该反馈'}), 400
    
    # 添加点赞
    feedback_item["upvoted_by"].append(current_user)
    feedback_item["upvotes"] = len(feedback_item["upvoted_by"])
    
    # 保存数据
    save_feedback(feedback_data)
    
    logger.info(f"用户 {current_user} 点赞反馈 {feedback_id}")
    return jsonify({'ok': True, 'upvotes': feedback_item["upvotes"]})

@app.route('/api/feedback/cancel-upvote', methods=['POST'])
def cancel_upvote_feedback():
    """取消点赞反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法取消点赞反馈")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    
    if not feedback_id:
        logger.warning(f"用户 {current_user} 取消点赞反馈失败：反馈ID为空")
        return jsonify({'ok': False, 'msg': '反馈ID不能为空'}), 400
    
    # 查找反馈项
    feedback_data = load_feedback()
    feedback_item = None
    for item in feedback_data["feedback"]:
        if item["id"] == feedback_id:
            feedback_item = item
            break
    
    if not feedback_item:
        logger.warning(f"用户 {current_user} 取消点赞反馈失败：反馈不存在")
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 检查用户是否已经点赞
    if current_user not in feedback_item["upvoted_by"]:
        logger.warning(f"用户 {current_user} 尚未点赞反馈 {feedback_id}")
        return jsonify({'ok': False, 'msg': '您还没有点赞该反馈'}), 400
    
    # 取消点赞
    feedback_item["upvoted_by"].remove(current_user)
    feedback_item["upvotes"] = len(feedback_item["upvoted_by"])
    
    # 保存数据
    save_feedback(feedback_data)
    
    logger.info(f"用户 {current_user} 取消点赞反馈 {feedback_id}")
    return jsonify({'ok': True, 'upvotes': feedback_item["upvotes"]})

@app.route('/api/feedback/delete', methods=['POST'])
def delete_feedback():
    """删除反馈"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法删除反馈")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 获取参数
    feedback_id = request.json.get('id', '')
    
    if not feedback_id:
        logger.warning(f"用户 {current_user} 删除反馈失败：反馈ID为空")
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
        logger.warning(f"用户 {current_user} 删除反馈失败：反馈不存在")
        return jsonify({'ok': False, 'msg': '反馈不存在'}), 404
    
    # 检查权限：只有反馈发送者或OP可以删除反馈
    if feedback_item["author"] != current_user and not is_op(current_user):
        logger.warning(f"用户 {current_user} 无权限删除反馈 {feedback_id}")
        return jsonify({'ok': False, 'msg': '您没有权限删除该反馈'}), 403
    
    # 删除反馈
    del feedback_data["feedback"][feedback_index]
    
    # 保存数据
    save_feedback(feedback_data)
    
    logger.info(f"用户 {current_user} 删除反馈 {feedback_id}")
    return jsonify({'ok': True, 'msg': '反馈删除成功'})

@app.route('/flowStatistics')
def flow_statistics():
    """处理对/flowStatistics的请求，避免404日志"""
    return '', 204  # 返回204 No Content状态码

@app.route('/api/admin/migrate-passwords', methods=['POST'])
def api_migrate_passwords():
    """迁移所有明文密码到哈希格式（仅用于开发/测试）"""
    users = load_users()
    current_user = request.headers.get('X-User')
    
    # 验证用户
    if current_user not in users:
        logger.warning(f"用户 {current_user} 未登录，无法执行密码迁移")
        return jsonify({'ok': False, 'msg': '用户未登录'}), 401
    
    # 检查权限：只有OP可以执行密码迁移
    if not is_op(current_user):
        logger.warning(f"用户 {current_user} 无权限执行密码迁移")
        return jsonify({'ok': False, 'msg': '只有管理员可以执行密码迁移'}), 403
    
    # 执行密码迁移
    migrated = migrate_passwords_to_hash()
    
    if migrated:
        logger.info(f"用户 {current_user} 执行了密码迁移")
        return jsonify({'ok': True, 'msg': '密码迁移成功'})
    else:
        logger.info(f"用户 {current_user} 尝试执行密码迁移，但所有密码已经是哈希格式")
        return jsonify({'ok': True, 'msg': '所有密码已经是哈希格式，无需迁移'})

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
    logger.info(f"用户 {username} 加入与 {friend} 的聊天室")
    emit('status', {'msg': f'{username}加入了聊天室'})

@socketio.on('leave')
def on_leave(data):
    """用户离开房间"""
    username = data['username']
    friend = data['friend']
    room = "_".join(sorted([username, friend]))
    leave_room(room)
    leave_room(username)
    logger.info(f"用户 {username} 离开与 {friend} 的聊天室")
    emit('status', {'msg': f'{username}离开了聊天室'})

@socketio.on('send_message')
def on_send_message(data):
    """通过WebSocket发送消息"""
    sender = data['sender']
    recipient = data['recipient']
    content = data['content']
    
    # 保存消息到数据库
    save_chat_message(sender, recipient, sender, content)
    logger.info(f"通过WebSocket发送消息：{sender} -> {recipient}")

# 排除CSRF保护的端点（API和WebSocket）
csrf.exempt(api_login)
csrf.exempt(api_send_message)
csrf.exempt(upload_image)
csrf.exempt(upload_file)
csrf.exempt(get_file_info)
csrf.exempt(api_add_friend)
csrf.exempt(api_remove_friend)
csrf.exempt(api_mark_messages_as_read)
csrf.exempt(api_clear_chat_history)
csrf.exempt(api_change_username)
csrf.exempt(api_change_password)
csrf.exempt(api_migrate_passwords)
csrf.exempt(submit_feedback)
csrf.exempt(set_feedback_status)
csrf.exempt(upvote_feedback)
csrf.exempt(cancel_upvote_feedback)
csrf.exempt(delete_feedback)
csrf.exempt(check_op_status)

if __name__ == '__main__':
    # 初始化数据库
    init_db()
    logger.info("聊天应用正在启动...")
    # 启动服务器（包括WebSocket支持）
    socketio.run(app, host='0.0.0.0', port=80, debug=True, allow_unsafe_werkzeug=True)
    # app.run(host='0.0.0.0', port=80, debug=True)

def is_user_involved_in_image_chat(current_user, image_id):
    """检查用户是否参与了包含该图片的聊天"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 查找包含该图片的消息
        cursor.execute('''
            SELECT sender, recipient 
            FROM messages 
            WHERE content = ?
        ''', (f"Pic_{image_id}",))
        
        result = cursor.fetchone()
        conn.close()
        
        if result:
            sender, recipient = result
            # 如果用户是发送者或接收者，则有权查看图片
            return current_user == sender or current_user == recipient
            
        return False
    except Exception as e:
        logger.error(f"检查用户聊天权限时出错: {e}")
        return False

def is_user_involved_in_file_chat(current_user, file_id):
    """检查用户是否参与了包含该文件的聊天"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 查找包含该文件的消息
        cursor.execute('''
            SELECT sender, recipient 
            FROM messages 
            WHERE content = ?
        ''', (f"File_{file_id}",))
        
        result = cursor.fetchone()
        conn.close()
        
        if result:
            sender, recipient = result
            # 如果用户是发送者或接收者，则有权查看文件
            return current_user == sender or current_user == recipient
            
        return False
    except Exception as e:
        logger.error(f"检查用户文件聊天权限时出错: {e}")
        return False