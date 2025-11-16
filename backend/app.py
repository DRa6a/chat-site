import sqlite3

from flask import Flask, request, jsonify, render_template
import json, pathlib, os
from datetime import datetime
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__,
            template_folder='../frontend',
            static_folder='../frontend/static')
app.config['SECRET_KEY'] = 'your-secret-key'

# 初始化SocketIO
socketio = SocketIO(app, cors_allowed_origins="*")

ROOT = pathlib.Path(__file__).resolve().parent.parent
USER_FILE = ROOT / 'data' / 'users.json'
FRIENDS_DIR = ROOT / 'data' / 'users'
CHATS_DIR = ROOT / 'data' / 'chats'
DB_FILE = ROOT / 'data' / 'chat.db'
os.makedirs(FRIENDS_DIR, exist_ok=True)
os.makedirs(CHATS_DIR, exist_ok=True)

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
    
    conn.commit()
    conn.close()

def load_users():
    with open(USER_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_users(users):
    with open(USER_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=4)

def get_chat_file(user1, user2):
    """获取聊天记录文件路径，确保两个用户间的聊天使用相同的文件"""
    chat_id = "_".join(sorted([user1, user2]))
    return CHATS_DIR / f"{chat_id}.json"

def load_chat_history(user1, user2):
    """加载两个用户之间的聊天记录"""
    # 首先尝试从数据库加载
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT sender, content, timestamp 
            FROM messages 
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
            ORDER BY timestamp ASC
        ''', (user1, user2, user2, user1))
        
        messages = []
        for row in cursor.fetchall():
            messages.append({
                "sender": row[0],
                "content": row[1],
                "timestamp": row[2]
            })
        
        conn.close()
        return messages
    except Exception as e:
        # 如果数据库出错，回退到文件系统
        chat_file = get_chat_file(user1, user2)
        if chat_file.exists():
            with open(chat_file, 'r', encoding='utf-8') as f:
                return json.load(f)
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
        ''', (sender, user2 if sender == user1 else user1, content, datetime.now().isoformat()))
        
        conn.commit()
        conn.close()
        
        # 通过WebSocket通知相关用户有新消息
        room = "_".join(sorted([user1, user2]))
        socketio.emit('new_message', {
            'sender': sender,
            'recipient': user2 if sender == user1 else user1,
            'content': content,
            'timestamp': datetime.now().isoformat()
        }, room=room)
    except Exception as e:
        print(f"保存到数据库时出错: {e}")
    
    # 同时保存到文件系统（为了向后兼容）
    chat_file = get_chat_file(user1, user2)
    messages = []
    if chat_file.exists():
        try:
            with open(chat_file, 'r', encoding='utf-8') as f:
                messages = json.load(f)
        except:
            messages = []
    
    message = {
        "sender": sender,
        "content": content,
        "timestamp": datetime.now().isoformat()
    }
    
    messages.append(message)
    
    with open(chat_file, 'w', encoding='utf-8') as f:
        json.dump(messages, f, ensure_ascii=False, indent=4)

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
    save_chat_message(current_user, recipient, current_user, content)
    
    return jsonify({'ok': True, 'msg': '消息发送成功'})

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

# WebSocket事件处理
@socketio.on('join')
def on_join(data):
    """用户加入房间"""
    username = data['username']
    friend = data['friend']
    room = "_".join(sorted([username, friend]))
    join_room(room)
    emit('status', {'msg': f'{username}加入了聊天室'})

@socketio.on('leave')
def on_leave(data):
    """用户离开房间"""
    username = data['username']
    friend = data['friend']
    room = "_".join(sorted([username, friend]))
    leave_room(room)
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
