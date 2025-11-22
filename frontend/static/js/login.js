const cb = document.getElementById('theme-cb');
const html = document.documentElement;
if (localStorage.getItem('theme') === 'dark') {
    html.classList.add('theme-dark');
    cb.checked = true;
}
cb.addEventListener('change', e => {
    html.classList.toggle('theme-dark', e.target.checked);
    localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
});

function showFeedback(msg, type) {
    const fb = document.getElementById('feedback');
    fb.textContent = msg;
    fb.className = type;
    fb.style.display = 'block';
    setTimeout(() => fb.style.display = 'none', 3000);
}

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: u, password: p})
    });
    const data = await res.json();
    if (data.ok) {
        showFeedback('登录成功! (^▽^)', 'success');
        // 生成唯一的会话ID
        const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        // 使用sessionStorage存储用户信息，确保每个标签页独立
        sessionStorage.setItem('chat-session-id', sessionId);
        sessionStorage.setItem('chat-user', u);
        sessionStorage.setItem('user-info', JSON.stringify(data));
        // 在localStorage中存储会话信息，用于在页面刷新时恢复
        const sessions = JSON.parse(localStorage.getItem('chat-sessions') || '{}');
        sessions[sessionId] = {
            user: u,
            userInfo: data,
            timestamp: Date.now()
        };
        localStorage.setItem('chat-sessions', JSON.stringify(sessions));
        setTimeout(() => location.href = '/', 1200);
    } else {
        showFeedback('用户名或密码错误', 'error');
    }
});