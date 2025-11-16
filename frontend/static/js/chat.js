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

// 保存用户名按钮点击事件
document.getElementById('save-username-btn').addEventListener('click', async () => {
    const newUsername = document.getElementById('username-input').value.trim();
    const currentUser = localStorage.getItem('chat-user');

    // 检查输入
    if (!newUsername) {
        alert('请输入新用户名！');
        return;
    }

    if (newUsername === currentUser) {
        alert('新用户名不能与当前用户名相同！');
        return;
    }

    // 发送请求更新用户名
    const res = await fetch('/api/change-username', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User': currentUser
        },
        body: JSON.stringify({newUsername: newUsername})
    });
    const data = await res.json();
    if (data.ok) {
        localStorage.setItem('chat-user', newUsername);
        document.getElementById('uname').textContent = newUsername;
        // 更新本地存储的用户信息
        const userInfo = JSON.parse(localStorage.getItem('user-info') || '{}');
        userInfo.username = newUsername;
        localStorage.setItem('user-info', JSON.stringify(userInfo));
        alert('用户名修改成功！');
    } else {
        // 根据后端返回的错误信息给出具体提示
        if (res.status === 401) {
            alert('用户名已存在或无权限修改！');
        } else {
            alert('用户名修改失败！');
        }
    }
});

// 保存密码按钮点击事件
document.getElementById('save-password-btn').addEventListener('click', async () => {
    const newPassword = document.getElementById('password-input').value.trim();
    const currentUser = localStorage.getItem('chat-user');

    // 检查输入
    if (!newPassword) {
        alert('请输入新密码！');
        return;
    }

    // 检查密码是否与当前密码相同
    const currentUserInfo = JSON.parse(localStorage.getItem('user-info') || '{}');
    if (newPassword === currentUserInfo.password) {
        alert('新密码不能与当前密码相同！');
        return;
    }

    // 发送请求更新密码
    const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User': currentUser
        },
        body: JSON.stringify({newPassword: newPassword})
    });
    const data = await res.json();
    if (data.ok) {
        // 更新本地存储的用户信息
        const userInfo = JSON.parse(localStorage.getItem('user-info') || '{}');
        userInfo.password = newPassword;
        localStorage.setItem('user-info', JSON.stringify(userInfo));
        alert('密码修改成功！');
    } else {
        alert('密码修改失败！');
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
