document.getElementById('uname').textContent = localStorage.getItem('chat-user');

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
loadFriends();
