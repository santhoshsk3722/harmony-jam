// GitHub Release & Service Worker Auto-Updater for Harmony Jam

export class AppUpdater {
  constructor() {
    this.currentVersion = '1.0.0';
    this.latestVersion = null;
    this.releaseUrl = null;
    this.swRegistration = null;
    // Auto-detect repo if hosted on github.io (e.g. username.github.io/repo)
    let autoRepo = 'santhoshsk3722/harmony-jam';
    if (window.location.hostname.endsWith('.github.io')) {
      const user = window.location.hostname.split('.')[0];
      const repoPath = window.location.pathname.split('/')[1];
      if (user && repoPath) {
        autoRepo = `${user}/${repoPath}`;
      }
    }
    this.githubRepo = localStorage.getItem('hj_github_repo') || autoRepo;

    this.onUpdateAvailableCallbacks = [];
  }

  async init() {
    // 1. Fetch local version manifest
    try {
      const res = await fetch('./version.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        this.currentVersion = data.version || '1.0.0';
      }
    } catch (e) {
      console.warn('Could not read version.json:', e);
    }

    // 2. Register Service Worker if supported
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('./sw.js');
        console.log('[SW] Registered successfully scope:', this.swRegistration.scope);

        // Check for SW updates on load
        this.swRegistration.addEventListener('updatefound', () => {
          const newWorker = this.swRegistration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version available!');
                this.notifyUpdate('New software update installed in background!');
              }
            });
          }
        });
      } catch (err) {
        console.warn('[SW] Registration failed:', err);
      }
    }

    // 3. Perform initial GitHub API check
    this.checkForGitHubUpdates();
  }

  setGitHubRepo(repoString) {
    if (!repoString) return;
    let cleanRepo = repoString.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    this.githubRepo = cleanRepo;
    localStorage.setItem('hj_github_repo', cleanRepo);
    this.checkForGitHubUpdates(true);
  }

  async checkForGitHubUpdates(manual = false) {
    if (!this.githubRepo) return;

    try {
      const apiUrl = `https://api.github.com/repos/${this.githubRepo}/releases/latest`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const release = await res.json();
        const tag = release.tag_name ? release.tag_name.replace(/^v/, '') : null;
        this.releaseUrl = release.html_url || `https://github.com/${this.githubRepo}`;

        if (tag && this.isNewerVersion(tag, this.currentVersion)) {
          this.latestVersion = tag;
          this.notifyUpdate(`New Version v${tag} available on GitHub!`, release.body);
          return { available: true, version: tag, notes: release.body };
        }
      }
    } catch (e) {
      console.warn('GitHub API update check failed:', e);
    }

    if (manual) {
      alert(`You are running the latest version (v${this.currentVersion}). No new updates found.`);
    }

    return { available: false, version: this.currentVersion };
  }

  isNewerVersion(latest, current) {
    const lParts = latest.split('.').map(Number);
    const cParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
      const l = lParts[i] || 0;
      const c = cParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  applyUpdate() {
    if (this.swRegistration && this.swRegistration.waiting) {
      this.swRegistration.waiting.postMessage({ action: 'skipWaiting' });
    }
    // Clear caches and force reload
    if ('caches' in window) {
      caches.keys().then(names => {
        return Promise.all(names.map(name => caches.delete(name)));
      }).then(() => {
        window.location.reload(true);
      });
    } else {
      window.location.reload(true);
    }
  }

  onUpdateAvailable(cb) {
    this.onUpdateAvailableCallbacks.push(cb);
  }

  notifyUpdate(message, releaseNotes = '') {
    this.onUpdateAvailableCallbacks.forEach(cb => cb({
      currentVersion: this.currentVersion,
      latestVersion: this.latestVersion || this.currentVersion,
      message,
      releaseNotes,
      releaseUrl: this.releaseUrl
    }));
  }
}
