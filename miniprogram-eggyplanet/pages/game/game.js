const app = getApp()

Page({
  data: {
    url: ''
  },

  onLoad() {
    this.setData({
      url: app.globalData.gameUrl
    })
  },

  onError(e) {
    console.error('web-view 加载失败', e.detail)
    wx.showToast({
      title: '加载失败，请检查网络或业务域名配置',
      icon: 'none',
      duration: 3000
    })
  }
})
