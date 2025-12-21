// 聊天功能实现
class ChatApp {
    constructor() {
        try {
            this.me = sessionStorage.getItem('chat-user');
        } catch(e) {
            console.error('获取用户信息时出错:', e);
            this.me = null;
        }
        this.peer = document.getElementById('peername').textContent;
        this.messages = [];
        this.pollingInterval = null;
        this.lastMessageCount = 0;
        this.hasNewMessage = false;
        this.originalTitle = document.title;

        // 图片查看器相关属性
        this.imageMessages = []; // 存储所有图片消息
        this.currentImageIndex = 0; // 当前查看的图片索引

        // 音乐播放相关属性
        this.currentAudio = null;
        this.currentPlayingButton = null;
        this.currentProgressInterval = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTheme();
        this.loadChatHistory();
        this.markMessagesAsRead(); // 标记当前聊天为已读
        this.scrollToBottom();
        // 启动轮询机制，每2秒检查一次新消息
        this.startPolling();

        // 创建图片查看器
        this.createImageViewer();

        // 创建歌词查看器
        this.createLyricsViewer();
    }

    setupEventListeners() {
        // 发送按钮事件
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        // 更多按钮事件
        document.getElementById('more-btn').addEventListener('click', () => {
            this.toggleMorePanel();
        });

        // 图片上传按钮事件
        document.getElementById('upload-image-btn').addEventListener('click', () => {
            document.getElementById('image-upload').click();
            this.hideMorePanel();
        });

        // 音乐搜索按钮事件
        document.getElementById('search-music-btn').addEventListener('click', () => {
            this.showMusicSearchModal();
            this.hideMorePanel();
        });

        // 图片选择事件
        document.getElementById('image-upload').addEventListener('change', (e) => {
            this.uploadImage(e.target.files[0]);
        });

        // 回车发送消息
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // 主题切换
        document.getElementById('theme-cb').addEventListener('change', (e) => {
            const html = document.documentElement;
            html.classList.toggle('theme-dark', e.target.checked);
            try {
                localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
            } catch(e) {
                console.log('无法访问localStorage:', e);
            }
        });

        // 页面获得焦点时清除新消息提示
        window.addEventListener('focus', () => {
            this.clearNewMessageIndicator();
        });

        // 点击页面其他地方隐藏更多功能面板
        document.addEventListener('click', (e) => {
            const morePanel = document.getElementById('more-panel');
            const moreBtn = document.getElementById('more-btn');

            if (morePanel.style.display === 'block' &&
                !morePanel.contains(e.target) &&
                e.target !== moreBtn) {
                this.hideMorePanel();
            }
        });

        // 音乐搜索相关事件
        document.getElementById('music-search-btn').addEventListener('click', () => {
            this.searchMusic();
        });

        document.getElementById('music-search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchMusic();
            }
        });

        document.getElementById('close-music-search').addEventListener('click', () => {
            this.closeMusicSearchModal();
        });

        // 字体大小调整事件
        const fontSizeSlider = document.getElementById('font-size-slider');
        if (fontSizeSlider) {
            fontSizeSlider.addEventListener('input', (e) => {
                this.setFontSize(e.target.value);
            });
        }

        // 页面缩放调整事件
        const zoomSlider = document.getElementById('zoom-slider');
        if (zoomSlider) {
            zoomSlider.addEventListener('input', (e) => {
                this.setZoomLevel(e.target.value);
            });
        }

        // 图片查看器事件监听器 (推迟到图片查看器创建后再设置)
        // 这些监听器将在 createImageViewer 方法中设置
    }

    // 切换更多功能面板显示/隐藏
    toggleMorePanel() {
        const morePanel = document.getElementById('more-panel');
        if (morePanel.style.display === 'block') {
            this.hideMorePanel();
        } else {
            this.showMorePanel();
        }
    }

    // 显示更多功能面板
    showMorePanel() {
        const morePanel = document.getElementById('more-panel');
        morePanel.style.display = 'block';
    }

    // 隐藏更多功能面板
    hideMorePanel() {
        const morePanel = document.getElementById('more-panel');
        morePanel.style.display = 'none';
    }

    // 显示音乐搜索模态框
    showMusicSearchModal() {
        const modal = document.getElementById('music-search-modal');
        modal.style.display = 'block';
        document.getElementById('music-search-input').focus();
    }

    // 关闭音乐搜索模态框
    closeMusicSearchModal() {
        const modal = document.getElementById('music-search-modal');
        modal.style.display = 'none';
        document.getElementById('music-search-input').value = '';
        document.getElementById('music-search-results').innerHTML = '';
    }

    // 搜索音乐
    async searchMusic() {
        const keyword = document.getElementById('music-search-input').value.trim();
        if (!keyword) {
            alert('请输入搜索关键词');
            return;
        }

        try {
            const searchBtn = document.getElementById('music-search-btn');
            const originalHTML = searchBtn.innerHTML;
            searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 搜索';
            searchBtn.disabled = true;

            const response = await fetch(`/api/music/search?keyword=${encodeURIComponent(keyword)}`);
            const result = await response.json();

            searchBtn.innerHTML = originalHTML;
            searchBtn.disabled = false;

            if (result.ok) {
                this.displayMusicSearchResults(result.songs);
            } else {
                alert(result.msg || '搜索失败');
            }
        } catch (error) {
            console.error('搜索音乐出错:', error);
            document.getElementById('music-search-btn').innerHTML = '<i class="fas fa-search"></i> 搜索';
            document.getElementById('music-search-btn').disabled = false;
            alert('搜索出错: ' + error.message);
        }
    }

    // 显示音乐搜索结果
    displayMusicSearchResults(songs) {
        const resultsContainer = document.getElementById('music-search-results');
        resultsContainer.innerHTML = '';

        if (songs.length === 0) {
            resultsContainer.innerHTML = '<p style="text-align: center; padding: 20px;">没有找到相关音乐</p>';
            return;
        }

        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'music-result-item';
            item.innerHTML = `
                <img src="${song.picUrl || '/static/images/music-placeholder.png'}"
                     alt="${song.name}"
                     class="music-result-cover"
                     onerror="this.src='/static/images/music-placeholder.png'">
                <div class="music-result-info">
                    <div class="music-result-name">${this.escapeHtml(song.name)}</div>
                    <div class="music-result-artists">${this.escapeHtml(song.artists.join(', '))}</div>
                </div>
            `;

            item.addEventListener('click', () => {
                this.sendMusicMessage(song);
            });

            resultsContainer.appendChild(item);
        });
    }

    // 发送音乐消息
    async sendMusicMessage(musicInfo) {
        try {
            const musicMessage = `Music_${JSON.stringify(musicInfo)}`;

            const response = await fetch('/api/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User': this.me
                },
                body: JSON.stringify({
                    recipient: this.peer,
                    content: musicMessage
                })
            });

            const result = await response.json();
            if (result.ok) {
                this.closeMusicSearchModal();
                // 立即检查新消息以确保显示最新内容
                setTimeout(() => this.checkForNewMessages(), 100);
            } else {
                alert(result.msg || '发送音乐消息失败');
            }
        } catch (error) {
            console.error('发送音乐消息出错:', error);
            alert('发送音乐消息失败: ' + error.message);
        }
    }

    // 创建图片查看器
    createImageViewer() {
        const imageViewerModal = document.createElement('div');
        imageViewerModal.id = 'image-viewer-modal';
        imageViewerModal.className = 'modal';
        imageViewerModal.innerHTML = `
            <div class="image-viewer-content">
                <span class="close-btn" id="close-image-viewer">&times;</span>
                <div class="image-container">
                    <img id="viewer-image" src="" alt="图片查看">
                </div>
                <div class="image-navigation">
                    <button id="prev-image" class="nav-btn">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="image-info">
                        <span id="current-image-index">1</span>/<span id="total-images">1</span>
                    </div>
                    <button id="next-image" class="nav-btn">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
                <div class="image-actions">
                    <button id="download-image" class="action-btn">
                        <i class="fas fa-download"></i> 下载
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(imageViewerModal);

        // 现在设置图片查看器的事件监听器
        this.setupImageViewerListeners();
    }

    setupImageViewerListeners() {
        // 确保图片查看器元素存在
        const imageViewerModal = document.getElementById('image-viewer-modal');
        if (!imageViewerModal) {
            console.error('图片查看器模态框未找到');
            return;
        }

        const closeImageViewer = document.getElementById('close-image-viewer');
        const prevImageBtn = document.getElementById('prev-image');
        const nextImageBtn = document.getElementById('next-image');
        const downloadImageBtn = document.getElementById('download-image');

        // 关闭图片查看器
        if (closeImageViewer) {
            closeImageViewer.addEventListener('click', () => {
                this.closeImageViewer();
            });
        }

        // 点击模态框外部关闭
        imageViewerModal.addEventListener('click', (event) => {
            if (event.target === imageViewerModal) {
                this.closeImageViewer();
            }
        });

        // 上一张图片
        if (prevImageBtn) {
            prevImageBtn.addEventListener('click', () => {
                this.showPrevImage();
            });
        }

        // 下一张图片
        if (nextImageBtn) {
            nextImageBtn.addEventListener('click', () => {
                this.showNextImage();
            });
        }

        // 下载图片
        if (downloadImageBtn) {
            downloadImageBtn.addEventListener('click', () => {
                this.downloadCurrentImage();
            });
        }

        // 键盘事件（ESC关闭，左右箭头切换图片）
        document.addEventListener('keydown', (event) => {
            const imageViewerModal = document.getElementById('image-viewer-modal');
            if (imageViewerModal && imageViewerModal.style.display === 'block') {
                switch (event.key) {
                    case 'Escape':
                        this.closeImageViewer();
                        break;
                    case 'ArrowLeft':
                        this.showPrevImage();
                        break;
                    case 'ArrowRight':
                        this.showNextImage();
                        break;
                }
            }
        });
    }

    // 创建歌词查看器
    createLyricsViewer() {
        const lyricsModal = document.createElement('div');
        lyricsModal.id = 'lyrics-modal';
        lyricsModal.className = 'lyrics-modal';
        lyricsModal.innerHTML = `
            <div class="lyrics-content">
                <span class="lyrics-close">&times;</span>
                <div class="lyrics-title"></div>
                <div class="lyrics-artist"></div>
                <div class="lyrics-text">加载中...</div>
            </div>
        `;

        document.body.appendChild(lyricsModal);

        // 设置事件监听器
        const closeBtn = lyricsModal.querySelector('.lyrics-close');
        closeBtn.addEventListener('click', () => {
            this.closeLyricsViewer();
        });

        lyricsModal.addEventListener('click', (event) => {
            if (event.target === lyricsModal) {
                this.closeLyricsViewer();
            }
        });
    }

    // 显示歌词
    async showLyrics(musicId, musicTitle, musicArtist) {
        const lyricsModal = document.getElementById('lyrics-modal');
        const titleEl = lyricsModal.querySelector('.lyrics-title');
        const artistEl = lyricsModal.querySelector('.lyrics-artist');
        const textEl = lyricsModal.querySelector('.lyrics-text');

        titleEl.textContent = musicTitle;
        artistEl.textContent = musicArtist;
        textEl.textContent = '加载中...';

        lyricsModal.style.display = 'block';

        try {
            const response = await fetch(`/api/music/lyric?id=${musicId}`);
            const result = await response.json();

            if (result.ok) {
                textEl.textContent = result.lyric || '暂无歌词';
            } else {
                textEl.textContent = '加载歌词失败';
            }
        } catch (error) {
            console.error('获取歌词出错:', error);
            textEl.textContent = '加载歌词出错';
        }
    }

    // 关闭歌词查看器
    closeLyricsViewer() {
        const lyricsModal = document.getElementById('lyrics-modal');
        lyricsModal.style.display = 'none';
    }

    // 更新进度条
    updateProgress(audioElement, progressBar, currentTimeEl, durationEl) {
        if (!audioElement || !progressBar) return;

        const currentTime = audioElement.currentTime;
        const duration = audioElement.duration || 0;

        // 更新进度条
        if (duration > 0) {
            const progressPercent = (currentTime / duration) * 100;
            progressBar.style.width = `${progressPercent}%`;
        }

        // 更新时间显示
        if (currentTimeEl) {
            currentTimeEl.textContent = this.formatTime(currentTime);
        }

        if (durationEl && duration > 0) {
            durationEl.textContent = this.formatTime(duration);
        }
    }

    // 格式化时间 (秒 -> mm:ss)
    formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // 播放音乐
    async playMusic(musicId, playButton, progressBar, currentTimeEl, durationEl, progressBarContainer) {
        try {
            // 如果正在播放其他音乐，先停止
            if (this.currentAudio) {
                this.currentAudio.pause();
                if (this.currentPlayingButton) {
                    this.currentPlayingButton.innerHTML = '<i class="fas fa-play"></i>';
                }
                // 清除之前的进度更新定时器
                if (this.currentProgressInterval) {
                    clearInterval(this.currentProgressInterval);
                    this.currentProgressInterval = null;
                }
            }

            // 获取音乐播放链接
            const response = await fetch(`/api/music/url?id=${musicId}`);
            const result = await response.json();

            if (result.ok) {
                // 创建或更新audio元素
                if (!this.currentAudio) {
                    this.currentAudio = new Audio();
                }

                this.currentAudio.src = result.url;
                this.currentAudio.play();

                // 更新按钮状态
                playButton.innerHTML = '<i class="fas fa-pause"></i>';
                this.currentPlayingButton = playButton;

                // 开始定期更新进度条
                this.currentProgressInterval = setInterval(() => {
                    this.updateProgress(this.currentAudio, progressBar, currentTimeEl, durationEl);
                }, 1000);

                // 监听播放结束事件
                this.currentAudio.onended = () => {
                    playButton.innerHTML = '<i class="fas fa-play"></i>';
                    this.currentPlayingButton = null;
                    if (this.currentProgressInterval) {
                        clearInterval(this.currentProgressInterval);
                        this.currentProgressInterval = null;
                    }
                    // 重置进度条
                    if (progressBar) {
                        progressBar.style.width = '0%';
                    }
                    if (currentTimeEl) {
                        currentTimeEl.textContent = '00:00';
                    }
                    if (durationEl) {
                        durationEl.textContent = '00:00';
                    }
                    this.currentAudio = null;
                };

                // 监听元数据加载完成事件以获取时长
                this.currentAudio.onloadedmetadata = () => {
                    this.updateProgress(this.currentAudio, progressBar, currentTimeEl, durationEl);
                };

                // 添加进度条拖动事件
                if (progressBarContainer) {
                    this.setupProgressDragging(progressBarContainer, progressBar, currentTimeEl, durationEl);
                }
            } else {
                alert(result.msg || '获取音乐播放链接失败');
            }
        } catch (error) {
            console.error('播放音乐出错:', error);
            alert('播放音乐失败: ' + error.message);
        }
    }

    // 设置进度条拖动功能
    setupProgressDragging(progressBarContainer, progressBar, currentTimeEl, durationEl) {
        if (!this.currentAudio || !progressBarContainer) return;

        let isDragging = false;

        // 点击进度条跳转到指定位置
        const seek = (e) => {
            const progressBarRect = progressBarContainer.getBoundingClientRect();
            const pos = (e.clientX - progressBarRect.left) / progressBarRect.width;
            const duration = this.currentAudio.duration || 0;
            if (duration > 0) {
                this.currentAudio.currentTime = pos * duration;
                this.updateProgress(this.currentAudio, progressBar, currentTimeEl, durationEl);
            }
        };

        // 鼠标按下事件
        progressBarContainer.addEventListener('mousedown', (e) => {
            isDragging = true;
            seek(e);
        });

        // 鼠标移动事件
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                seek(e);
            }
        });

        // 鼠标释放事件
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // 暂停音乐
    pauseMusic() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            if (this.currentPlayingButton) {
                this.currentPlayingButton.innerHTML = '<i class="fas fa-play"></i>';
            }
            if (this.currentProgressInterval) {
                clearInterval(this.currentProgressInterval);
                this.currentProgressInterval = null;
            }
            this.currentPlayingButton = null;
            this.currentAudio = null;
        }
    }

    // 打开图片查看器
    openImageViewer(imageId, imageElement) {
        // 收集所有图片消息
        this.collectImageMessages();

        // 找到点击的图片在数组中的位置
        this.currentImageIndex = this.imageMessages.findIndex(msg =>
            msg.element === imageElement || msg.id === imageId);

        if (this.currentImageIndex === -1) {
            this.currentImageIndex = 0;
        }

        // 显示图片查看器
        this.showCurrentImage();
        const imageViewerModal = document.getElementById('image-viewer-modal');
        if (imageViewerModal) {
            imageViewerModal.style.display = 'block';
            document.body.style.overflow = 'hidden'; // 防止背景滚动
        }
    }

    // 关闭图片查看器
    closeImageViewer() {
        const imageViewerModal = document.getElementById('image-viewer-modal');
        if (imageViewerModal) {
            imageViewerModal.style.display = 'none';
            document.body.style.overflow = ''; // 恢复背景滚动
        }
    }

    // 收集所有图片消息
    collectImageMessages() {
        const messageElements = document.querySelectorAll('.message-image img, .message-image .image-loading');
        this.imageMessages = Array.from(messageElements).map((element, index) => {
            // 从data属性中提取图片ID
            const imageId = element.getAttribute('data-image-id');
            
            return {
                id: imageId,
                element: element,
                src: element.src || ''
            };
        });
    }

    // 显示当前图片
    async showCurrentImage() {
        if (this.imageMessages.length === 0) return;

        const currentImage = this.imageMessages[this.currentImageIndex];
        const viewerImage = document.getElementById('viewer-image');
        if (viewerImage) {
            // 通过API获取图片数据
            try {
                const response = await fetch(`/api/get-image/${currentImage.id}`, {
                    headers: {
                        'X-User': this.me
                    }
                });
                
                if (response.ok) {
                    const blob = await response.blob();
                    const imageUrl = URL.createObjectURL(blob);
                    viewerImage.src = imageUrl;
                } else {
                    viewerImage.src = '/static/images/image-error.png';
                }
            } catch (error) {
                console.error('加载查看器图片失败:', error);
                viewerImage.src = '/static/images/image-error.png';
            }
        }

        // 更新图片信息
        const currentImageIndexElement = document.getElementById('current-image-index');
        const totalImagesElement = document.getElementById('total-images');
        if (currentImageIndexElement && totalImagesElement) {
            currentImageIndexElement.textContent = this.currentImageIndex + 1;
            totalImagesElement.textContent = this.imageMessages.length;
        }

        // 控制导航按钮的显示
        const prevImageBtn = document.getElementById('prev-image');
        const nextImageBtn = document.getElementById('next-image');
        if (prevImageBtn && nextImageBtn) {
            prevImageBtn.disabled = this.currentImageIndex === 0;
            nextImageBtn.disabled = this.currentImageIndex === this.imageMessages.length - 1;
        }
    }

    // 显示上一张图片
    showPrevImage() {
        if (this.currentImageIndex > 0) {
            this.currentImageIndex--;
            this.showCurrentImage();
        }
    }

    // 显示下一张图片
    showNextImage() {
        if (this.currentImageIndex < this.imageMessages.length - 1) {
            this.currentImageIndex++;
            this.showCurrentImage();
        }
    }

    // 下载当前图片
    async downloadCurrentImage() {
        if (this.imageMessages.length === 0) return;

        const currentImage = this.imageMessages[this.currentImageIndex];
        const imageId = currentImage.id;
        
        try {
            // 通过API获取图片数据
            const response = await fetch(`/api/get-image/${imageId}`, {
                headers: {
                    'X-User': this.me
                }
            });
            
            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `image_${imageId}.jpg`; // 默认文件名
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                alert('下载图片失败');
            }
        } catch (error) {
            console.error('下载图片失败:', error);
            alert('下载图片失败');
        }
    }

    loadTheme() {
        const html = document.documentElement;
        try {
            // 加载深色/浅色主题
            if (localStorage.getItem('theme') === 'dark') {
                html.classList.add('theme-dark');
                document.getElementById('theme-cb').checked = true;
            }
            
            // 检查保存的主题选择
            const savedTheme = localStorage.getItem('selected-theme');
            if (savedTheme === 'pink') {
                this.switchTheme('pink');
            }
        } catch(e) {
            console.log('无法访问localStorage:', e);
        }
    }

    // 主题切换功能
    switchTheme(theme) {
        const head = document.head;
        const existingLink = document.querySelector('link[href*="style-pink"]');
        
        try {
            // 保存用户选择的主题到localStorage
            localStorage.setItem('selected-theme', theme);
        } catch(e) {
            console.log('无法访问localStorage:', e);
        }
        
        if (theme === 'pink') {
            // 如果已经引入了粉色主题，则不做任何操作
            if (existingLink) return;
            
            // 否则创建新的link元素引入粉色主题
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/static/css/style-pink.css';
            head.appendChild(link);
        } else {
            // 移除粉色主题
            if (existingLink) {
                existingLink.remove();
            }
        }
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (content) {
            // 发送到服务器
            const response = await fetch('/api/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User': this.me
                },
                body: JSON.stringify({
                    recipient: this.peer,
                    content: content
                })
            });

            const result = await response.json();
            if (result.ok) {
                // 不再在这里直接添加消息到UI，而是等待下一次轮询
                input.value = '';
                this.scrollToBottom();

                // 立即检查新消息以确保显示最新内容
                setTimeout(() => this.checkForNewMessages(), 100);
            } else {
                alert(result.msg || '发送消息失败');
            }
        }
    }

    async uploadImage(imageFile) {
        if (!imageFile) return;

        // 创建FormData对象用于上传文件
        const formData = new FormData();
        formData.append('image', imageFile);

        try {
            // 显示上传中提示
            const sendButton = document.getElementById('send-btn');
            const morePanelBtn = document.getElementById('upload-image-btn');
            const originalSendText = sendButton.innerHTML;
            const originalMorePanelBtnHTML = morePanelBtn.innerHTML;

            sendButton.disabled = true;
            morePanelBtn.disabled = true;
            sendButton.innerHTML = '上传中...';
            morePanelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传中...';

            // 上传图片
            const uploadResponse = await fetch('/api/upload-image', {
                method: 'POST',
                headers: {
                    'X-User': this.me
                },
                body: formData
            });

            const uploadResult = await uploadResponse.json();

            // 恢复按钮状态
            sendButton.disabled = false;
            morePanelBtn.disabled = false;
            sendButton.innerHTML = originalSendText;
            morePanelBtn.innerHTML = '<i class="fas fa-image"></i> <span>发送图片</span>';

            if (uploadResult.ok) {
                // 上传成功，发送图片消息
                const imageMessage = `Pic_${uploadResult.image_id}`;
                const response = await fetch('/api/send-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        recipient: this.peer,
                        content: imageMessage
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    // 清空文件选择
                    document.getElementById('image-upload').value = '';
                    // 立即检查新消息以确保显示最新内容
                    setTimeout(() => this.checkForNewMessages(), 100);
                } else {
                    this.showErrorMessage(result.msg || '发送图片消息失败');
                }
            } else {
                this.showErrorMessage(uploadResult.msg || '图片上传失败');
            }
        } catch (error) {
            console.error('上传图片出错:', error);
            this.showErrorMessage('图片上传失败: ' + error.message);

            // 恢复按钮状态
            const sendButton = document.getElementById('send-btn');
            const morePanelBtn = document.getElementById('upload-image-btn');
            sendButton.disabled = false;
            morePanelBtn.disabled = false;
            sendButton.innerHTML = '发送';
            morePanelBtn.innerHTML = '<i class="fas fa-image"></i> <span>发送图片</span>';
        }
    }

    // 显示错误消息
    showErrorMessage(message) {
        // 创建或更新错误消息元素
        let errorMsg = document.getElementById('upload-error-message');
        if (!errorMsg) {
            errorMsg = document.createElement('div');
            errorMsg.id = 'upload-error-message';
            errorMsg.className = 'feedback-message error';
            // 将错误消息插入到输入框上方
            const inputContainer = document.querySelector('.input-container');
            inputContainer.parentNode.insertBefore(errorMsg, inputContainer);
        }

        errorMsg.textContent = message;
        errorMsg.style.display = 'block';

        // 3秒后自动隐藏错误消息
        setTimeout(() => {
            errorMsg.style.display = 'none';
        }, 3000);
    }

    addMessageToUI(message, isOwnMessage = false) {
        const container = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');

        // 检查是否是图片消息
        if (message.content.startsWith('Pic_')) {
            // 提取图片ID
            const imageId = message.content.substring(4);
            // 图片消息不使用气泡样式，直接显示图片
            messageElement.className = 'message-image';
            // 使用加载动画占位符
            messageElement.innerHTML = `
                <div class="image-loading" data-image-id="${imageId}" style="width: 200px; height: 200px; border-radius: 10px; border: 1px solid rgba(0, 0, 0, 0.1); display: flex; align-items: center; justify-content: center;"></div>
            `;
            // 根据发送者设置对齐方式
            if (isOwnMessage) {
                messageElement.style.alignSelf = 'flex-end';
            } else {
                messageElement.style.alignSelf = 'flex-start';
            }

            // 获取真实的图片数据
            const loadingElement = messageElement.querySelector('.image-loading');
            this.loadImageData(imageId, loadingElement);
        }
        // 检查是否是音乐消息
        else if (message.content.startsWith('Music_')) {
            // 提取音乐信息
            const musicInfo = JSON.parse(message.content.substring(6));

            // 音乐消息使用特殊样式
            messageElement.className = `message-bubble ${isOwnMessage ? 'me' : 'peer'}`;

            // 构建音乐消息HTML，包括VIP标识（如果有的话）
            let vipBadge = '';
            if (musicInfo.isVip) {
                vipBadge = '<span class="music-vip-badge">VIP</span>';
            }

            messageElement.innerHTML = `
                <div class="music-message">
                    <div class="music-cover">
                        <img src="${musicInfo.picUrl || '/static/images/music-placeholder.png'}" alt="专辑封面" onerror="this.src='/static/images/music-placeholder.png'">
                    </div>
                    <div class="music-info">
                        <div class="music-title">${this.escapeHtml(musicInfo.name)} ${vipBadge}</div>
                        <div class="music-artist">${this.escapeHtml(musicInfo.artists.join(', '))}</div>
                        <div class="music-controls">
                            <button class="music-play-btn" data-music-id="${musicInfo.id}">
                                <i class="fas fa-play"></i>
                            </button>
                            <div class="music-progress-container">
                                <span class="music-current-time">00:00</span>
                                <div class="music-progress-bar">
                                    <div class="music-progress" style="width: 0%"></div>
                                </div>
                                <span class="music-duration">00:00</span>
                            </div>
                            <button class="music-lyrics-btn" data-music-id="${musicInfo.id}" data-music-title="${this.escapeHtml(musicInfo.name)}" data-music-artist="${this.escapeHtml(musicInfo.artists.join(', '))}">
                                <i class="fas fa-align-left"></i>
                            </button>
                        </div>
                        <div class="music-source">音乐来源：网易云音乐</div>
                        <audio class="music-audio" style="display: none;"></audio>
                    </div>
                </div>
            `;

            // 添加播放按钮事件监听器
            const playBtn = messageElement.querySelector('.music-play-btn');
            const progressBar = messageElement.querySelector('.music-progress');
            const currentTimeEl = messageElement.querySelector('.music-current-time');
            const durationEl = messageElement.querySelector('.music-duration');
            const progressBarContainer = messageElement.querySelector('.music-progress-container');

            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const musicId = playBtn.getAttribute('data-music-id');

                // 检查当前按钮状态
                const icon = playBtn.querySelector('i');
                if (icon.classList.contains('fa-play')) {
                    // 播放音乐
                    this.playMusic(musicId, playBtn, progressBar, currentTimeEl, durationEl, progressBarContainer);
                } else {
                    // 暂停音乐
                    this.pauseMusic();
                }
            });

            // 添加歌词按钮事件监听器
            const lyricsBtn = messageElement.querySelector('.music-lyrics-btn');
            lyricsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const musicId = lyricsBtn.getAttribute('data-music-id');
                const musicTitle = lyricsBtn.getAttribute('data-music-title');
                const musicArtist = lyricsBtn.getAttribute('data-music-artist');
                this.showLyrics(musicId, musicTitle, musicArtist);
            });
        }
        else {
            // 文字消息使用气泡样式
            messageElement.className = `message-bubble ${isOwnMessage ? 'me' : 'peer'}`;
            messageElement.innerHTML = `
                <div class="message-content">${this.escapeHtml(message.content)}</div>
            `;
        }

        container.appendChild(messageElement);

        // 返回创建的元素，以便调用者可以进一步处理
        return messageElement;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async loadChatHistory() {
        try {
            const response = await fetch(`/api/chat-history?friend=${this.peer}`, {
                headers: {
                    'X-User': this.me
                }
            });

            const result = await response.json();
            if (result.ok) {
                const container = document.getElementById('chat-messages');
                container.innerHTML = '';

                // 创建一个Promise数组来跟踪所有图片加载
                const imagePromises = [];

                result.history.forEach((msg, index) => {
                    const message = {
                        sender: msg.sender,
                        content: msg.content,
                        timestamp: new Date(msg.timestamp)
                    };
                    const isOwnMessage = msg.sender === this.me;

                    // 判断是否显示时间戳
                    let showTime = true;
                    if (index > 0) {
                        const previousMsg = result.history[index - 1];
                        const previousTime = new Date(previousMsg.timestamp);
                        const currentTime = new Date(msg.timestamp);

                        // 计算时间差（毫秒）
                        const timeDiff = Math.abs(currentTime - previousTime);

                        // 如果时间差小于5分钟（300,000毫秒），不显示时间戳
                        if (timeDiff < 300000) {
                            showTime = false;
                        }
                    }

                    // 如果需要显示时间，则添加时间分隔符
                    if (showTime) {
                        this.addTimeDivider(message.timestamp);
                    }

                    // 添加消息到UI
                    const messageElement = this.addMessageToUI(message, isOwnMessage);

                    // 如果是图片消息，将图片加载Promise添加到数组中
                    if (message.content.startsWith('Pic_')) {
                        const img = messageElement.querySelector('img');
                        const imgPromise = new Promise((resolve) => {
                            img.onload = () => {
                                resolve();
                            };
                            img.onerror = () => {
                                resolve(); // 即使加载失败也继续
                            };
                        });
                        imagePromises.push(imgPromise);
                    }
                });

                this.lastMessageCount = result.history.length;

                // 等待所有图片加载完成后再滚动到底部
                if (imagePromises.length > 0) {
                    Promise.all(imagePromises).then(() => {
                        this.scrollToBottom();
                    });
                } else {
                    this.scrollToBottom();
                }
            } else {
                console.error('加载聊天历史失败:', result.msg);
            }
        } catch (error) {
            console.error('加载聊天历史出错:', error);
        }
    }

    // 新增：添加时间分隔符
    addTimeDivider(timestamp) {
        const container = document.getElementById('chat-messages');
        const dividerElement = document.createElement('div');
        dividerElement.className = 'time-divider';

        const timeString = new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        dividerElement.textContent = timeString;
        container.appendChild(dividerElement);
    }

    // 标记当前聊天消息为已读
    async markMessagesAsRead() {
        try {
            await fetch('/api/mark-messages-as-read', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User': this.me
                },
                body: JSON.stringify({
                    friend: this.peer
                })
            });

            // 通知首页更新未读消息计数
            try {
                localStorage.setItem('unread_updated', Date.now().toString());
            } catch (e) {
                console.error('无法更新localStorage:', e);
            }
        } catch (error) {
            console.error('标记消息为已读出错:', error);
        }
    }

    // 新增：轮询获取新消息
    async checkForNewMessages() {
        try {
            const response = await fetch(`/api/chat-history?friend=${this.peer}`, {
                headers: {
                    'X-User': this.me
                }
            });

            const result = await response.json();
            if (result.ok) {
                // 检查是否有新消息
                if (result.history.length > this.lastMessageCount) {
                    // 有新消息，更新显示
                    const newMessageCount = result.history.length - this.lastMessageCount;
                    const container = document.getElementById('chat-messages');

                    // 只处理新增的消息，而不是清空整个容器
                    const startIndex = this.lastMessageCount;

                    for (let i = startIndex; i < result.history.length; i++) {
                        const msg = result.history[i];
                        const message = {
                            sender: msg.sender,
                            content: msg.content,
                            timestamp: new Date(msg.timestamp)
                        };
                        const isOwnMessage = msg.sender === this.me;

                        // 判断是否显示时间戳
                        let showTime = true;
                        if (i > 0) {
                            const previousMsg = result.history[i - 1];
                            const previousTime = new Date(previousMsg.timestamp);
                            const currentTime = new Date(msg.timestamp);

                            // 计算时间差（毫秒）
                            const timeDiff = Math.abs(currentTime - previousTime);

                            // 如果时间差小于5分钟（300,000毫秒），不显示时间戳
                            if (timeDiff < 300000) {
                                showTime = false;
                            }
                        }

                        // 如果需要显示时间，则添加时间分隔符
                        if (showTime) {
                            this.addTimeDivider(message.timestamp);
                        }

                        // 添加消息到UI
                        this.addMessageToUI(message, isOwnMessage);
                    }

                    this.lastMessageCount = result.history.length;

                    // 如果不是自己发送的消息，则显示新消息提示
                    const lastMessage = result.history[result.history.length - 1];
                    if (lastMessage.sender !== this.me) {
                        this.showNewMessageIndicator(newMessageCount);
                    }
                }
            }
        } catch (error) {
            console.error('检查新消息出错:', error);
        }
    }

    // 显示新消息提示
    showNewMessageIndicator(newMessageCount) {
        // 只有在页面不处于焦点状态时才显示提示
        if (!document.hasFocus()) {
            this.hasNewMessage = true;
            // 更新页面标题显示新消息提示
            document.title = `(${newMessageCount}) ${this.originalTitle}`;

            // 尝试使用浏览器通知（如果支持且已授权）
            this.showNotification(newMessageCount);
        }
    }

    // 清除新消息提示
    clearNewMessageIndicator() {
        if (this.hasNewMessage) {
            this.hasNewMessage = false;
            document.title = this.originalTitle;
        }
    }

    // 显示浏览器通知
    showNotification(newMessageCount) {
        // 检查浏览器是否支持通知
        if ('Notification' in window) {
            // 检查用户是否已授权显示通知
            if (Notification.permission === 'granted') {
                new Notification('新消息', {
                    body: `您有${newMessageCount}条来自${this.peer}的新消息`,
                    icon: '/favicon.ico'
                });
            } else if (Notification.permission !== 'denied') {
                // 请求用户授权
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification('新消息', {
                            body: `您有${newMessageCount}条来自${this.peer}的新消息`,
                            icon: '/favicon.ico'
                        });
                    }
                });
            }
        }
    }

    // 新增：启动轮询
    startPolling() {
        this.pollingInterval = setInterval(() => {
            this.checkForNewMessages();
        }, 2000); // 每2秒检查一次新消息
    }

    // 新增：停止轮询
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    // 删除好友
    async removeFriend() {
        if (confirm(`确定要删除好友 ${this.peer} 吗？`)) {
            try {
                const response = await fetch('/api/remove-friend', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        friendName: this.peer
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    alert('好友删除成功');
                    // 跳转回好友列表页面
                    location.href = '/';
                } else {
                    alert(result.msg || '删除好友失败');
                }
            } catch (error) {
                console.error('删除好友出错:', error);
                alert('删除好友失败');
            }
        }
    }

    // 清空聊天记录
    async clearChatHistory() {
        if (confirm(`确定要清空与 ${this.peer} 的所有聊天记录吗？此操作不可恢复！`)) {
            try {
                const response = await fetch('/api/clear-chat-history', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        friendName: this.peer
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    alert('聊天记录已清空');
                    // 清空聊天界面
                    document.getElementById('chat-messages').innerHTML = '';
                    this.lastMessageCount = 0;
                } else {
                    alert(result.msg || '清空聊天记录失败');
                }
            } catch (error) {
                console.error('清空聊天记录出错:', error);
                alert('清空聊天记录失败');
            }
        }
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        // 使用平滑滚动到底部
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
    }

    destroy() {
        // 停止轮询
        this.stopPolling();
        // 标记消息为已读
        this.markMessagesAsRead();
        // 关闭图片查看器
        this.closeImageViewer();
        // 关闭歌词查看器
        this.closeLyricsViewer();
        // 暂停音乐播放
        this.pauseMusic();
    }

    // 获取图片真实数据
    async loadImageData(imageId, loadingElement) {
        try {
            const response = await fetch(`/api/get-image/${imageId}`, {
                headers: {
                    'X-User': this.me
                }
            });
            
            if (response.ok) {
                // 获取图片的blob数据
                const blob = await response.blob();
                const imageUrl = URL.createObjectURL(blob);
                
                // 替换加载元素为实际图片
                const img = document.createElement('img');
                img.src = imageUrl;
                img.alt = "图片";
                img.style.maxWidth = "200px";
                img.style.maxHeight = "200px";
                img.style.borderRadius = "10px";
                img.style.border = "1px solid rgba(0, 0, 0, 0.1)";
                img.setAttribute('data-image-id', imageId);
                
                // 为图片添加点击事件，打开图片查看器
                img.addEventListener('click', () => {
                    this.openImageViewer(imageId, img);
                });
                
                // 处理图片加载完成后的滚动
                img.onload = () => {
                    // 图片加载完成后重新滚动到底部
                    this.scrollToBottom();
                };
                img.onerror = () => {
                    // 图片加载失败时也确保滚动到底部
                    this.scrollToBottom();
                };
                
                // 替换加载元素
                loadingElement.parentNode.replaceChild(img, loadingElement);
            } else {
                // 处理错误情况
                loadingElement.innerHTML = '<i class="fas fa-exclamation-circle" style="color: red; font-size: 24px;"></i>';
                this.scrollToBottom();
            }
        } catch (error) {
            console.error('加载图片失败:', error);
            loadingElement.innerHTML = '<i class="fas fa-exclamation-circle" style="color: red; font-size: 24px;"></i>';
            this.scrollToBottom();
        }
    }
}

// 页面加载完成后初始化聊天应用
let chatApp = null;

document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();

    // 监听返回按钮点击事件
    const backBtn = document.querySelector('.back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (chatApp) {
                chatApp.markMessagesAsRead();
            }
        });
    }

    // 添加聊天设置相关事件监听
    const chatSettingsBtn = document.getElementById('chat-settings-btn');
    const chatSettingsModal = document.getElementById('chat-settings-modal');
    const closeChatSettings = document.getElementById('close-chat-settings');
    const editNicknameBtn = document.getElementById('edit-nickname-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const deleteFriendBtn = document.getElementById('delete-friend-btn');
    const peerName = document.getElementById('peername').textContent;

    if (chatSettingsBtn && chatSettingsModal) {
        // 打开设置模态框
        chatSettingsBtn.addEventListener('click', function() {
            chatSettingsModal.style.display = 'block';
        });

        // 关闭设置模态框的统一方法
        function closeSettings() {
            chatSettingsModal.style.display = 'none';
        }

        // 绑定关闭事件
        closeChatSettings.addEventListener('click', closeSettings);

        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
            if (event.target === chatSettingsModal) {
                closeSettings();
            }
        });

        // 修改好友昵称
        editNicknameBtn.addEventListener('click', function() {
            const newNickname = prompt('请输入新的昵称:', peerName);
            if (newNickname && newNickname.trim() !== '' && newNickname !== peerName) {
                // 这里应该调用后端API来保存昵称
                alert('功能开发中：修改好友昵称功能');
            }
            closeSettings();
        });

        // 清空聊天记录
        clearChatBtn.addEventListener('click', function() {
            if (chatApp) {
                chatApp.clearChatHistory();
            }
            closeSettings();
        });

        // 删除好友
        deleteFriendBtn.addEventListener('click', function() {
            if (chatApp) {
                chatApp.removeFriend();
            }
            closeSettings();
        });
    }
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (chatApp) {
        chatApp.destroy();
    }
});