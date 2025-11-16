// 设置按钮点击事件
document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'block';
    // 填充当前用户名和密码
    const user = JSON.parse(localStorage.getItem('user-info') || '{}');
    document.getElementById('username-input').value = user.username || '';
    document.getElementById('password-input').value = user.password || ''; // 显示当前密码
});

// 关闭按钮点击事件
document.getElementById('close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'none';
});

// 退出登录按钮点击事件
document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('确定要退出登录吗？')) {
        localStorage.removeItem('chat-user');
        localStorage.removeItem('user-info');
        location.href = '/login';
    }
});

// 主题切换
const themeCb = document.getElementById('theme-cb');
const html = document.documentElement;
if (localStorage.getItem('theme') === 'dark') {
    html.classList.add('theme-dark');
    themeCb.checked = true;
}
themeCb.addEventListener('change', e => {
    html.classList.toggle('theme-dark', e.target.checked);
    localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
});

// 保存更改按钮点击事件
document.getElementById('save-changes-btn').addEventListener('click', async () => {
    const newUsername = document.getElementById('username-input').value.trim();
    const newPassword = document.getElementById('password-input').value.trim();
    if (newUsername) {
        const res = await fetch('/api/change-username', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({newUsername: newUsername})
        });
        const data = await res.json();
        if (data.ok) {
            alert('用户名修改成功！');
            localStorage.setItem('chat-user', newUsername);
            document.getElementById('uname').textContent = newUsername;
            localStorage.setItem('user-info', JSON.stringify({username: newUsername, password: newPassword}));
        } else {
            alert('用户名修改失败，请重试。');
        }
    }
    if (newPassword) {
        const res = await fetch('/api/change-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({newPassword: newPassword})
        });
        const data = await res.json();
        if (data.ok) {
            alert('密码修改成功！');
            localStorage.setItem('user-info', JSON.stringify({username: newUsername, password: newPassword}));
        } else {
            alert('密码修改失败，请重试。');
        }
    }
});

// 加载好友列表
async function loadFriends() {
    const res = await fetch('/api/friends?u=' + localStorage.getItem('chat-user'));
    const list = await res.json();
    const html = list.map(name => `
        <div class="friend-card glass" data-friend="${name}">
            <span class="fname">${name}</span>
        </div>`).join('');
    document.getElementById('fcards').innerHTML = html;

    document.querySelectorAll('.friend-card').forEach(card => {
        card.addEventListener('click', () => {
            location.href = '/chat/' + card.dataset.friend;
        });
    });
}

// 显示用户名
document.getElementById('uname').textContent = localStorage.getItem('chat-user');

// 初始化加载好友列表
loadFriends();
