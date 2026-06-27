App({
  globalData: {
    // 开关：dev 环境下是否强制使用正式环境的 URL
    // true  -> 即使在开发环境也使用正式环境 CDN
    // false -> 开发环境使用本地地址
    useProdUrlInDev: false,

    get gameUrl() {
      const localUrl = 'http://192.168.123.5:5173/MagicHaqi.html'
      const prodUrl = 'https://keepwork.com/api/raw/maisi/maisi/webgames/MagicHaqi/MagicHaqi.html'

      const isDev = __wxConfig.envVersion === 'develop'
      // 非开发环境始终用正式；开发环境根据开关决定
      if (!isDev) return prodUrl
      return this.useProdUrlInDev ? prodUrl : localUrl
    }
  }
})
