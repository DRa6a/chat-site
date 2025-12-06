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

document.addEventListener('DOMContentLoaded', function() {
    // 检测主题设置
    try {
        const theme = localStorage.getItem('theme');
        if (theme === 'dark') {
            document.documentElement.classList.add('theme-dark');
        }
    } catch(e) {
        console.log('无法访问localStorage:', e);
    }

    // 主题切换
    const themeCb = document.getElementById('theme-cb');
    if (themeCb) {
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
    }

    // 登录表单提交
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            login();
        });
    }
});

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showFeedback('请填写用户名和密码', 'error');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.ok) {
            // 保存用户信息到 sessionStorage
            sessionStorage.setItem('chat-user', username);
            showFeedback('登录成功，正在跳转...', 'success');
            // 跳转到主页
            setTimeout(() => {
                location.href = '/';
            }, 1000);
        } else {
            showFeedback('用户名或密码错误', 'error');
        }
    } catch (error) {
        console.error('登录失败:', error);
        showFeedback('登录时发生错误', 'error');
    }
}

function showFeedback(message, type) {
    const feedback = document.getElementById('feedback');
    if (feedback) {
        feedback.textContent = message;
        feedback.className = type;
        feedback.style.display = 'block';
        
        // 3秒后自动隐藏
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 3000);
    }
}
