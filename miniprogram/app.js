App({
  globalData: {
    // 开发环境指向本地，正式环境指向 keepwork CDN
    gameUrl: __wxConfig.envVersion === 'develop'
      ? 'http://localhost:5173/MagicHaqi.html'
      : 'https://keepwork.com/api/raw/maisi/maisi/webgames/MagicHaqi/MagicHaqi.html'
  }
})
