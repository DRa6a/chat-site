from flask import Flask, request, jsonify, render_template
import json, pathlib, os

app = Flask(__name__,
            template_folder='../frontend',
            static_folder='../frontend/static')

ROOT = pathlib.Path(__file__).resolve().parent.parent
USER_FILE = ROOT / 'data' / 'users.json'
FRIENDS_DIR = ROOT / 'data' / 'users'
os.makedirs(FRIENDS_DIR, exist_ok=True)

def load_users():
    with open(USER_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_users(users):
    with open(USER_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=4)

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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)
