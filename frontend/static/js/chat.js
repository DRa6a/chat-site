// 设置按钮点击事件
document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'block';
    // 填充当前用户名和密码
    try {
        const user = JSON.parse(sessionStorage.getItem('user-info') || '{}');
        document.getElementById('username-input').value = user.username || '';
        document.getElementById('password-input').value = user.password || ''; // 显示当前密码
    } catch(e) {
        console.error('解析用户信息时出错:', e);
    }
});

// 关闭按钮点击事件
document.getElementById('close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'none';
});

// 退出登录按钮点击事件（模态框按钮）
document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('确定要退出登录吗？')) {
        try {
            // 清除sessionStorage中的用户信息
            sessionStorage.removeItem('chat-user');
            sessionStorage.removeItem('user-info');
        } catch(e) {
            console.error('退出登录时出错:', e);
        }
        location.href = '/login';
    }
});

// 主题切换
const themeCb = document.getElementById('theme-cb');
const html = document.documentElement;
try {
    if (localStorage.getItem('theme') === 'dark') {
        html.classList.add('theme-dark');
        themeCb.checked = true;
    }
} catch(e) {
    console.log('无法访问localStorage:', e);
}

themeCb.addEventListener('change', e => {
    try {
        html.classList.toggle('theme-dark', e.target.checked);
        localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
    } catch(e) {
        console.log('无法访问localStorage:', e);
    }
});

// 保存用户名按钮点击事件
document.getElementById('save-username-btn').addEventListener('click', async () => {
    const newUsername = document.getElementById('username-input').value.trim();
    const currentUser = sessionStorage.getItem('chat-user');

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
        try {
            sessionStorage.setItem('chat-user', newUsername);
            document.getElementById('uname').textContent = newUsername;
            // 更新sessionStorage中的用户信息
            const userInfo = JSON.parse(sessionStorage.getItem('user-info') || '{}');
            userInfo.username = newUsername;
            sessionStorage.setItem('user-info', JSON.stringify(userInfo));
        } catch(e) {
            console.error('更新会话信息时出错:', e);
            alert('会话信息更新失败！');
            return;
        }
        
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
    const currentUser = sessionStorage.getItem('chat-user');

    // 检查输入
    if (!newPassword) {
        alert('请输入新密码！');
        return;
    }

    // 检查密码是否与当前密码相同
    const currentUserInfo = JSON.parse(sessionStorage.getItem('user-info') || '{}');
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
        try {
            // 更新sessionStorage中的用户信息
            const userInfo = JSON.parse(sessionStorage.getItem('user-info') || '{}');
            userInfo.password = newPassword;
            sessionStorage.setItem('user-info', JSON.stringify(userInfo));
        } catch(e) {
            console.error('更新会话信息时出错:', e);
            alert('会话信息更新失败！');
            return;
        }
        
        alert('密码修改成功！');
    } else {
        alert('密码修改失败！');
    }
});

// 检查未读消息
async function checkUnreadMessages() {
    try {
        const res = await fetch('/api/unread-messages', {
            headers: {
                'X-User': sessionStorage.getItem('chat-user')
            }
        });
        const data = await res.json();
        if (data.ok) {
            // 更新好友列表中的未读消息提示
            updateUnreadIndicators(data.unread_counts);
        }
    } catch (error) {
        console.error('检查未读消息出错:', error);
    }
}

// 更新好友列表中的未读消息提示
function updateUnreadIndicators(unreadCounts) {
    // 清除所有现有的未读消息提示
    document.querySelectorAll('.unread-badge').forEach(el => el.remove());
    
    // 为每个有未读消息的好友添加提示
    for (const [friend, count] of Object.entries(unreadCounts)) {
        if (count > 0) {
            // 查找对应的好友卡片
            const friendCard = document.querySelector(`.friend-card[data-friend="${friend}"]`);
            if (friendCard) {
                // 创建未读消息提示元素
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = count > 99 ? '99+' : count;
                
                // 添加到好友卡片中
                friendCard.style.position = 'relative';
                friendCard.appendChild(badge);
            }
        }
    }
}

// 加载好友列表
async function loadFriends() {
    try {
        const res = await fetch('/api/friends?u=' + sessionStorage.getItem('chat-user'));
        const list = await res.json();
        const html = list.map(name => {
            // 为每个好友卡片添加data-friend属性，方便后续扩展
            return `
            <div class="friend-card glass" data-friend="${name}">
                <span class="fname">${name}</span>
            </div>`;
        }).join('');
        document.getElementById('fcards').innerHTML = html;

        document.querySelectorAll('.friend-card').forEach(card => {
            card.addEventListener('click', () => {
                location.href = '/chat/' + card.dataset.friend;
            });
        });
        
        // 加载完成后检查未读消息
        checkUnreadMessages();
    } catch(e) {
        console.error('加载好友列表时出错:', e);
    }
}

// 显示用户名
try {
    document.getElementById('uname').textContent = sessionStorage.getItem('chat-user');
} catch(e) {
    console.error('获取用户名时出错:', e);
}

// 初始化加载好友列表
loadFriends();

// 添加好友按钮点击事件
document.getElementById('add-friend-btn').addEventListener('click', async () => {
    const friendName = document.getElementById('friend-input').value.trim();
    const currentUser = sessionStorage.getItem('chat-user');
    const feedbackElement = document.getElementById('add-friend-feedback');

    // 检查输入
    if (!friendName) {
        showAddFriendFeedback('请输入好友用户名！', 'error');
        return;
    }

    if (friendName === currentUser) {
        showAddFriendFeedback('不能添加自己为好友！', 'error');
        return;
    }

    // 发送请求添加好友
    const res = await fetch('/api/add-friend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User': currentUser
        },
        body: JSON.stringify({friendName: friendName})
    });
    const data = await res.json();
    if (data.ok) {
        showAddFriendFeedback(data.msg, 'success');
        document.getElementById('friend-input').value = ''; // 清空输入框
        // 重新加载好友列表
        loadFriends();
        // 3秒后隐藏成功提示
        setTimeout(() => {
            feedbackElement.style.display = 'none';
        }, 3000);
    } else {
        showAddFriendFeedback(data.msg || '添加好友失败！', 'error');
    }
});

// 显示添加好友反馈信息
function showAddFriendFeedback(message, type) {
    const feedbackElement = document.getElementById('add-friend-feedback');
    feedbackElement.textContent = message;
    feedbackElement.className = 'feedback-message ' + type;
    feedbackElement.style.display = 'block';

    // 3秒后自动隐藏错误提示
    if (type === 'error') {
        setTimeout(() => {
            feedbackElement.style.display = 'none';
        }, 3000);
    }
}

// 页面加载完成后开始定期检查未读消息
document.addEventListener('DOMContentLoaded', () => {
    // 每5秒重新加载好友列表和检查未读消息（确保及时更新）
    setInterval(loadFriends, 5000);
    
    // 连接到自己的房间以接收未读消息更新
    const currentUser = sessionStorage.getItem('chat-user');
    if (socket && currentUser) {
        socket.emit('join', {
            username: currentUser,
            friend: currentUser // 加入自己的房间
        });
        
        // 监听未读消息更新事件
        socket.on('unread_update', function(data) {
            // 当收到未读消息更新通知时，重新检查未读消息
            checkUnreadMessages();
        });
    }
});