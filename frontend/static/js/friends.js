// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 加载好友列表
    loadFriends();
    
    // 绑定添加好友按钮事件
    document.getElementById('add-friend-btn').addEventListener('click', addFriend);
    
    // 绑定回车键事件
    document.getElementById('friend-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addFriend();
        }
    });
    
    // 主题切换
    const themeCb = document.getElementById('theme-cb');
    themeCb.checked = document.documentElement.classList.contains('theme-dark');
    themeCb.addEventListener('change', function() {
        if (this.checked) {
            document.documentElement.classList.add('theme-dark');
            try {
                localStorage.setItem('theme', 'dark');
            } catch(e) {
                console.log('无法保存主题设置:', e);
            }
        } else {
            document.documentElement.classList.remove('theme-dark');
            try {
                localStorage.setItem('theme', 'light');
            } catch(e) {
                console.log('无法保存主题设置:', e);
            }
        }
    });
    
    // 设置相关元素和事件绑定
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    const logoutBtn = document.getElementById('logout-btn');
    const saveUsernameBtn = document.getElementById('save-username-btn');
    const savePasswordBtn = document.getElementById('save-password-btn');
    
    // 打开设置模态框
    settingsBtn.addEventListener('click', function() {
        settingsModal.style.display = 'block';
        // 加载当前用户名到设置表单
        const currentUser = sessionStorage.getItem('chat-user') || '';
        document.getElementById('username-input').value = currentUser;
    });
    
    // 关闭设置模态框
    closeSettings.addEventListener('click', function() {
        settingsModal.style.display = 'none';
    });
    
    // 点击模态框外部关闭
    window.addEventListener('click', function(event) {
        if (event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });
    
    // 保存用户名
    saveUsernameBtn.addEventListener('click', function() {
        const newUsername = document.getElementById('username-input').value.trim();
        if (newUsername) {
            changeUsername(newUsername);
        }
    });
    
    // 保存密码
    savePasswordBtn.addEventListener('click', function() {
        const newPassword = document.getElementById('password-input').value.trim();
        if (newPassword) {
            changePassword(newPassword);
        }
    });
    
    // 退出登录
    logoutBtn.addEventListener('click', function() {
        sessionStorage.removeItem('chat-user');
        location.href = '/login';
    });
});

// 显示反馈消息
function showAddFriendFeedback(message, type) {
    const feedback = document.getElementById('add-friend-feedback');
    feedback.textContent = message;
    feedback.className = 'feedback-message ' + type;
    feedback.style.display = 'block';
    
    // 3秒后自动隐藏
    setTimeout(() => {
        feedback.style.display = 'none';
    }, 3000);
}

// 加载好友列表
async function loadFriends() {
    try {
        const response = await fetch(`/api/friends?u=${encodeURIComponent(sessionStorage.getItem('chat-user') || '')}`);
        const friends = await response.json();
        
        const container = document.getElementById('fcards');
        container.innerHTML = '';
        
        // 获取未读消息数
        const unreadResponse = await fetch('/api/unread-messages', {
            method: 'GET',
            headers: {
                'X-User': sessionStorage.getItem('chat-user')
            }
        });
        const unreadData = await unreadResponse.json();
        const unreadCounts = unreadData.ok ? unreadData.unread_counts : {};
        
        // 为每个好友创建卡片
        for (const friend of friends) {
            if (friend === sessionStorage.getItem('chat-user')) continue; // 跳过自己
            
            const card = document.createElement('div');
            card.className = 'friend-card';
            card.textContent = friend;
            
            // 添加未读消息提示
            const unreadCount = unreadCounts[friend] || 0;
            if (unreadCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                card.style.position = 'relative';
                card.appendChild(badge);
            }
            
            card.addEventListener('click', () => {
                location.href = `/chat/${encodeURIComponent(friend)}`;
            });
            
            container.appendChild(card);
        }
    } catch (error) {
        console.error('加载好友列表失败:', error);
    }
}

// 添加好友
async function addFriend() {
    const input = document.getElementById('friend-input');
    const friendName = input.value.trim();
    
    if (!friendName) {
        showAddFriendFeedback('请输入好友用户名', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/add-friend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': sessionStorage.getItem('chat-user')
            },
            body: JSON.stringify({ friendName })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            showAddFriendFeedback(data.msg, 'success');
            input.value = '';
            loadFriends(); // 重新加载好友列表
        } else {
            showAddFriendFeedback(data.msg, 'error');
        }
    } catch (error) {
        console.error('添加好友失败:', error);
        showAddFriendFeedback('添加好友时发生错误', 'error');
    }
}

// 检查是否为OP用户
async function checkOPStatus(username) {
    try {
        const response = await fetch('/api/user/op-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: username })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            const opStatusElement = document.getElementById('op-status');
            if (data.isOP) {
                opStatusElement.style.display = 'block';
            } else {
                opStatusElement.style.display = 'none';
            }
        } else {
            console.error('检查OP状态失败:', data.msg);
        }
    } catch (error) {
        console.error('检查OP状态失败:', error);
    }
}

// 修改用户名
async function changeUsername(newUsername) {
    try {
        const response = await fetch('/api/change-username', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': sessionStorage.getItem('chat-user')
            },
            body: JSON.stringify({ newUsername })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            sessionStorage.setItem('chat-user', newUsername);
            showAddFriendFeedback('用户名修改成功', 'success');
            // 更新输入框中的用户名
            document.getElementById('username-input').value = newUsername;
            // 更新页面标题
            document.getElementById('uname').textContent = newUsername;
            // 检查新的OP状态
            checkOPStatus(newUsername);
        } else {
            showAddFriendFeedback('用户名修改失败', 'error');
        }
    } catch (error) {
        console.error('修改用户名失败:', error);
        showAddFriendFeedback('修改用户名时发生错误', 'error');
    }
}

// 修改密码
async function changePassword(newPassword) {
    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': sessionStorage.getItem('chat-user')
            },
            body: JSON.stringify({ newPassword })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            showAddFriendFeedback('密码修改成功', 'success');
            // 清空密码输入框
            document.getElementById('password-input').value = '';
        } else {
            showAddFriendFeedback('密码修改失败', 'error');
        }
    } catch (error) {
        console.error('修改密码失败:', error);
        showAddFriendFeedback('修改密码时发生错误', 'error');
    }
}

// 定期检查未读消息
setInterval(async () => {
    try {
        const response = await fetch('/api/unread-messages', {
            method: 'GET',
            headers: {
                'X-User': sessionStorage.getItem('chat-user')
            }
        });
        
        const data = await response.json();
        
        if (data.ok) {
            const unreadCounts = data.unread_counts;
            // 更新好友列表上的未读消息提示
            document.querySelectorAll('.friend-card').forEach(card => {
                const friendName = card.textContent.split('\n')[0]; // 获取好友名（去除可能的徽章）
                const unreadCount = unreadCounts[friendName] || 0;
                
                // 移除现有的未读徽章
                const existingBadge = card.querySelector('.unread-badge');
                if (existingBadge) {
                    existingBadge.remove();
                }
                
                // 添加新的未读徽章
                if (unreadCount > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    card.style.position = 'relative';
                    card.appendChild(badge);
                }
            });
        }
    } catch (error) {
        console.error('检查未读消息失败:', error);
    }
}, 5000); // 每5秒检查一次