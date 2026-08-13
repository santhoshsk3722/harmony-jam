# 🎵 Harmony Jam - Collaborative Mobile PWA Music App

> A lightweight, free, mobile-first, Spotify-inspired music player built for **2+ users to control music together in real-time** like Discord, with **individual volume selection**, **queue management**, **sleep timer**, and **automatic GitHub over-the-air (OTA) updates**.

![Harmony Jam UI](https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1000&auto=format&fit=crop&q=80)

---

## ✨ Features

- 🎧 **Spotify-Inspired Aesthetic**: Sleek dark theme (`#121212`), glassmorphism, dynamic ambient lighting matching album artwork, bottom mini-player, expanded full-screen player drawer, audio spectrum canvas visualizer.
- 👥 **Real-Time Collaborative Jam Rooms (2+ Users)**:
  - Create or join rooms with a 6-digit PIN code or shareable QR code link.
  - Synchronized play/pause, seek scrub, track skipping, and queue reordering across all room members.
  - Automatic drift alignment (< 1.5s tolerance).
- 🔊 **Individual Volume Selection (Crucial Requirement)**:
  - Adjust your local volume slider without affecting anyone else in the room!
- 🌙 **Sleep Timer**:
  - Set a 15m, 30m, 45m, or 60m room/local countdown timer with soft audio fade-out during the final 10 seconds.
- 📱 **Mobile PWA & Native App Installation**:
  - Works on iOS Safari & Android Chrome. Tap "Add to Home Screen" for a full native app experience.
- 🔄 **GitHub Deployment & Self-Update System**:
  - Hosted 100% free on **GitHub Pages**.
  - In-app **GitHub Updater**: Checks GitHub Releases API / `version.json` and notifies users with a 1-click "Update & Reload" button whenever new features are pushed to your GitHub repo.
  - Complete `.github/workflows/deploy.yml` included for automatic deployment on `git push`.

---

## 🚀 How to Host on GitHub (100% Free)

1. **Create a GitHub Repository**:
   - Go to [GitHub.com](https://github.com/new) and create a repository named `harmony-jam`.
2. **Push the Files**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Harmony Jam"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/harmony-jam.git
   git push -u origin main
   ```
3. **Enable GitHub Pages**:
   - In your repository, go to **Settings > Pages**.
   - Under **Build and deployment > Source**, select **GitHub Actions**.
   - The included workflow `.github/workflows/deploy.yml` will automatically deploy your app to:
     `https://YOUR_USERNAME.github.io/harmony-jam/`

---

## 📱 How to Download / Install on Mobile Devices

### Option A: Progressive Web App (PWA) - Recommended
1. Open your GitHub Pages URL on your mobile phone (`https://YOUR_USERNAME.github.io/harmony-jam/`).
2. **Android (Chrome)**: Tap the banner **"Install App to Home Screen"** or tap menu ⋮ > **Add to Home Screen**.
3. **iOS (Safari)**: Tap the **Share** button ⎋ > **Add to Home Screen**.
4. The app icon will appear on your home screen and open in full standalone app mode!

### Option B: Build Android APK for GitHub Releases (PWABuilder - 100% Free)
1. Go to [PWABuilder.com](https://www.pwabuilder.com/).
2. Enter your live GitHub Pages URL (`https://YOUR_USERNAME.github.io/harmony-jam/`).
3. Click **Build My PWA** > select **Android**.
4. Download the generated `.apk` file and attach it under **Releases > Draft a new release** on your GitHub repository for direct APK downloads!

---

## 🛠️ Architecture & Free Tools Used

| Feature | Service / Tool | Cost |
| :--- | :--- | :--- |
| **Hosting** | GitHub Pages | FREE |
| **Realtime P2P Sync** | PeerJS (WebRTC) + BroadcastChannel API | FREE |
| **PWA Cache & Updates** | Service Worker + GitHub REST API | FREE |
| **Icons & Avatars** | Lucide Icons & DiceBear API | FREE |
| **Audio Engine** | HTML5 Audio & Web Audio API Visualizer | FREE |

---

## 📄 License
MIT License. Open source & free to customize!
