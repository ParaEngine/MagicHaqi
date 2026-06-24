App({
  onLaunch: function () {
    this.checkForUpdate()
  },

  // 强制更新：检测到新版本后下载，下载就绪即强制重启应用
  checkForUpdate: function () {
    if (!wx.canIUse('getUpdateManager')) {
      return
    }

    const updateManager = wx.getUpdateManager()

    updateManager.onCheckForUpdate(function (res) {
      // 请求完新版本信息的回调，res.hasUpdate 表示有新版本
      if (res.hasUpdate) {
        // 新版本会在后台自动下载
      }
    })

    updateManager.onUpdateReady(function () {
      wx.showModal({
        title: '更新提示',
        content: '检测到新版本，需要重启后才能继续使用~',
        showCancel: false,
        confirmText: '立即重启',
        success: function (res) {
          if (res.confirm) {
            // 新的版本已经下载好，调用 applyUpdate 应用新版本并重启
            updateManager.applyUpdate()
          }
        }
      })
    })

    updateManager.onUpdateFailed(function () {
      // 新版本下载失败，引导用户手动更新
      wx.showModal({
        title: '已经有新版本了哟~',
        content: '新版本已经上线啦，请您删除当前小程序，重新搜索打开哟~',
        showCancel: false
      })
    })
  },

  globalData: {
    // 开关：dev 环境下是否强制使用正式环境的 URL
    // true  -> 即使在开发环境也使用正式环境 CDN
    // false -> 开发环境使用本地地址
    useProdUrlInDev: true,

    get gameUrl() {
      const localUrl = 'http://192.168.123.5:5173/MagicHaqi.html'
      const prodUrl = 'https://keepwork.com/api/raw/maisi/maisi/webgames/MagicHaqi/release/MagicHaqi_v1.html'

      const isDev = __wxConfig.envVersion === 'develop'
      // 非开发环境始终用正式；开发环境根据开关决定
      if (!isDev) return prodUrl
      return this.useProdUrlInDev ? prodUrl : localUrl
    }
  }
})
