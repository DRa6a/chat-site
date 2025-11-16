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

// document.getElementById('login-form').addEventListener('submit', async e => {
//     e.preventDefault();
//     const u = document.getElementById('username').value.trim();
//     const p = document.getElementById('password').value;
//     const res = await fetch('/api/login', {
//         method: 'POST',
//         headers: {'Content-Type': 'application/json'},
//         body: JSON.stringify({username: u, password: p})
//     });
//     const data = await res.json();
//     if (data.ok) {
//         showFeedback('登录成功! (^▽^)', 'success');
//         localStorage.setItem('chat-user', u);
//         setTimeout(() => location.href = '/', 1200);
//     } else {
//         
//     }
// });

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
        localStorage.setItem('chat-user', u);
        localStorage.setItem('user-info', JSON.stringify(data)); // 保存用户信息
        // location.href = '/';
        setTimeout(() => location.href = '/', 1200);
    } else {
        showFeedback('用户名或密码错误', 'error');
    }
});
