// GitHub Push Release & Service Worker Auto-Updater for Harmony Jam

export class AppUpdater {
  constructor() {
    this.currentVersion = '2.1.0';
    this.currentCommitSha = sessionStorage.getItem('hj_current_commit_sha') || null;
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
    // 1. Read local version manifest
    try {
      const res = await fetch('./version.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        this.currentVersion = data.version || '2.1.0';
      }
    } catch (e) {
      console.warn('Could not read version.json:', e);
    }

    // 2. Register Service Worker if supported
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('./sw.js');
        
        // Listen for SW controller change or new SW installed
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[SW] Controller changed - new version active!');
          this.notifyUpdate('New software update deployed to GitHub!');
        });

        this.swRegistration.addEventListener('updatefound', () => {
          const newWorker = this.swRegistration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version installed in background!');
                this.notifyUpdate('New software update deployed to GitHub!');
              }
            });
          }
        });
      } catch (err) {
        console.warn('[SW] Registration warning:', err);
      }
    }

    // 3. Perform initial check
    this.checkForGitHubUpdates();

    // 4. Poll for new GitHub pushes every 15 seconds
    setInterval(() => {
      this.pollForNewPush();
    }, 15000);
  }

  setGitHubRepo(repoString) {
    if (!repoString) return;
    let cleanRepo = repoString.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    this.githubRepo = cleanRepo;
    localStorage.setItem('hj_github_repo', cleanRepo);
    this.checkForGitHubUpdates(true);
  }

  async pollForNewPush() {
    // Check version.json manifest first
    try {
      const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.version && this.isNewerVersion(data.version, this.currentVersion)) {
          this.latestVersion = data.version;
          this.notifyUpdate(`New version v${data.version} deployed to GitHub!`, data.releaseNotes);
          return;
        }
      }
    } catch (e) {}

    // Check GitHub Commits API for latest commit SHA on main
    if (!this.githubRepo) return;
    try {
      const apiRes = await fetch(`https://api.github.com/repos/${this.githubRepo}/commits/main?t=` + Date.now(), {
        cache: 'no-store'
      });
      if (apiRes.ok) {
        const commitData = await apiRes.json();
        const latestSha = commitData.sha ? commitData.sha.substring(0, 7) : null;

        if (latestSha) {
          if (!this.currentCommitSha) {
            this.currentCommitSha = latestSha;
            sessionStorage.setItem('hj_current_commit_sha', latestSha);
          } else if (latestSha !== this.currentCommitSha) {
            console.log(`[Updater] New push detected on GitHub! Previous: ${this.currentCommitSha}, New: ${latestSha}`);
            this.currentCommitSha = latestSha;
            sessionStorage.setItem('hj_current_commit_sha', latestSha);
            
            const message = commitData.commit ? commitData.commit.message : 'New code update pushed to main!';
            this.notifyUpdate(`New update pushed to GitHub (${latestSha})!`, message);
          }
        }
      }
    } catch (e) {
      console.warn('[Updater] GitHub commit check:', e);
    }
  }

  async checkForGitHubUpdates(manual = false) {
    if (!this.githubRepo) return;

    try {
      const apiUrl = `https://api.github.com/repos/${this.githubRepo}/releases/latest`;
      const res = await fetch(apiUrl, { cache: 'no-store' });
      if (res.ok) {
        const release = await res.json();
        const tag = release.tag_name ? release.tag_name.replace(/^v/, '') : null;
        this.releaseUrl = release.html_url || `https://github.com/${this.githubRepo}`;

        if (tag && this.isNewerVersion(tag, this.currentVersion)) {
          this.latestVersion = tag;
          this.notifyUpdate(`New Release v${tag} available on GitHub!`, release.body);
          return { available: true, version: tag, notes: release.body };
        }
      }
    } catch (e) {
      console.warn('GitHub API check warning:', e);
    }

    if (manual) {
      alert(`Current Version: v${this.currentVersion}. Checking GitHub for new commits...`);
      this.pollForNewPush();
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

  // --- HARD REFRESH & CACHE PURGE ---
  async applyUpdate() {
    console.log('[Updater] Performing Hard Refresh & Service Worker Purge...');
    
    // 1. Unregister all Service Workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
          await registration.unregister();
        }
      } catch (e) {}
    }

    // 2. Clear all CacheStorage caches
    if ('caches' in window) {
      try {
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      } catch (e) {}
    }

    // 3. Force hard reload with timestamp cache-buster
    const cacheBusterUrl = window.location.pathname + '?hard_refresh=' + Date.now();
    window.location.href = cacheBusterUrl;
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
