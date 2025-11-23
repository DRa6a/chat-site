const cb = document.getElementById('theme-cb');
const html = document.documentElement;
try {
    if (localStorage.getItem('theme') === 'dark') {
        html.classList.add('theme-dark');
        cb.checked = true;
    }
} catch(e) {
    console.log('无法访问localStorage:', e);
}

cb.addEventListener('change', e => {
    try {
        html.classList.toggle('theme-dark', e.target.checked);
        localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
    } catch(e) {
        console.log('无法访问localStorage:', e);
    }
});

function showFeedback(msg, type) {
    const fb = document.getElementById('feedback');
    fb.textContent = msg;
    fb.className = type;
    fb.style.display = 'block';
    setTimeout(() => fb.style.display = 'none', 3000);
}

// 添加一个兼容性检查函数
function isFetchSupported() {
    return window.fetch && window.Promise;
}

// 添加一个传统的 XMLHttpRequest 登录函数作为备选方案
function loginWithXHR(username, password) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/login');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('解析响应失败'));
                    }
                } else {
                    reject(new Error('登录请求失败'));
                }
            }
        };
        xhr.onerror = function () {
            reject(new Error('网络错误'));
        };
        xhr.send(JSON.stringify({username: username, password: password}));
    });
}

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    
    let data;
    try {
        if (isFetchSupported()) {
            // 使用现代的 fetch API
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: u, password: p})
            });
            data = await res.json();
        } else {
            // 使用传统的 XMLHttpRequest 作为备选
            data = await loginWithXHR(u, p);
        }
        
        if (data.ok) {
            showFeedback('登录成功! (^▽^)', 'success');
            
            // 简化会话管理 - 直接使用 sessionStorage 存储用户信息
            try {
                sessionStorage.setItem('chat-user', u);
                sessionStorage.setItem('user-info', JSON.stringify({username: u, password: p}));
                
                console.log('用户信息保存成功:', u);
            } catch(e) {
                console.error('存储用户信息时出错:', e);
                showFeedback('用户信息存储失败', 'error');
                return;
            }
            
            // 增加延迟确保会话信息保存完成后再跳转
            setTimeout(() => {
                console.log('正在跳转到主页...');
                location.href = '/';
            }, 1500);
        } else {
            showFeedback('用户名或密码错误', 'error');
        }
    } catch (error) {
        console.error('登录错误:', error);
        showFeedback('登录失败: ' + error.message, 'error');
    }
});