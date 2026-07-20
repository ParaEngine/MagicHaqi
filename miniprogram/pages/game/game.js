const app = getApp()

// web-view 加载超时时间（毫秒）
const WEB_VIEW_TIMEOUT = 15000
const WORKBUDDY_APP_ID = 'wx907c65e5e107ddcf'

function getReferrerExtraData() {
  try {
    return wx.getEnterOptionsSync?.()?.referrerInfo?.extraData
      || wx.getLaunchOptionsSync?.()?.referrerInfo?.extraData
      || {}
  } catch (e) {
    return {}
  }
}

function getImportGameDraft(options = {}) {
  const extra = getReferrerExtraData()
  return options.importGameDraft
    || options.workBuddyDraft
    || options.wbDraft
    || options.draftId
    || extra.importGameDraft
    || extra.workBuddyDraft
    || extra.wbDraft
    || extra.draftId
    || ''
}

function openWorkBuddy(promptText) {
  wx.setClipboardData({
    data: String(promptText || ''),
    success() {
      wx.navigateToMiniProgram({
        appId: WORKBUDDY_APP_ID,
        path: '',
        envVersion: 'release',
        extraData: {
          from: 'MagicHaqi',
          action: 'pastePrompt'
        },
        fail(err) {
          console.error('打开 WorkBuddy 失败', err)
          wx.showToast({
            title: '已复制提示词，请手动打开 WorkBuddy',
            icon: 'none'
          })
        }
      })
    },
    fail(err) {
      console.error('复制 WorkBuddy 提示词失败', err)
      wx.showToast({
        title: '复制提示词失败',
        icon: 'none'
      })
    }
  })
}

Page({
  data: {
    url: '',
    loading: true,
    retryCount: 0,
    // 分享数据：由 H5 页面通过 postMessage 动态更新
    shareTitle: '蛋蛋星球 MagicHaqi',
    shareDesc: '快来玩我做的小游戏！',
    sharePath: '',
    shareImageUrl: ''
  },

  _timeoutTimer: null,
  // 从分享路径带过来的游戏标识（gameFrom/game），拼进 web-view url 让接收方直达该游戏
  _shareParams: '',
  _lastImportGameDraft: '',

  onLoad(options) {
    const parts = []
    if (options && options.gameFrom) parts.push('gameFrom=' + encodeURIComponent(options.gameFrom))
    if (options && options.game) parts.push('game=' + encodeURIComponent(options.game))
<<<<<<< HEAD
    if (options && options.msg) parts.push('msg=' + encodeURIComponent(options.msg))
=======
    const importGameDraft = getImportGameDraft(options || {})
    if (importGameDraft) {
      this._lastImportGameDraft = importGameDraft
      parts.push('importGameDraft=' + encodeURIComponent(importGameDraft))
    }
>>>>>>> origin/main
    this._shareParams = parts.join('&')
    this._loadWebView()
  },

  onShow() {
    const importGameDraft = getImportGameDraft()
    if (!importGameDraft) return
    if (this._lastImportGameDraft === importGameDraft) return
    this._lastImportGameDraft = importGameDraft
    const nextParams = 'importGameDraft=' + encodeURIComponent(importGameDraft)
    if (this._shareParams === nextParams) return
    this._shareParams = nextParams
    this._loadWebView()
  },

  onUnload() {
    this._clearTimer()
  },

  _clearTimer() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer)
      this._timeoutTimer = null
    }
  },

  _loadWebView() {
    this._clearTimer()
    const query = (this._shareParams ? this._shareParams + '&' : '') + '_t=' + Date.now()
    this.setData({
      loading: true,
      url: app.globalData.gameUrl + '?' + query
    })

    // 手动超时检测：如果 web-view 在规定时间内没有 bindload，主动提示
    this._timeoutTimer = setTimeout(() => {
      if (this.data.loading) {
        console.warn('web-view 加载超时，尝试重试...')
        this._retryOrFail()
      }
    }, WEB_VIEW_TIMEOUT)
  },

  _retryOrFail() {
    const retryCount = this.data.retryCount
    if (retryCount < 2) {
      this.setData({ retryCount: retryCount + 1 })
      wx.showToast({
        title: `加载较慢，正在重试(${retryCount + 1}/3)...`,
        icon: 'none',
        duration: 2000
      })
      // 重新加载
      setTimeout(() => this._loadWebView(), 1500)
    } else {
      this._clearTimer()
      this.setData({ loading: false })
      wx.showModal({
        title: '加载失败',
        content: '网页加载超时，请检查网络连接后重试',
        confirmText: '重试',
        cancelText: '返回',
        success: (res) => {
          if (res.confirm) {
            this.setData({ retryCount: 0 })
            this._loadWebView()
          } else {
            wx.navigateBack()
          }
        }
      })
    }
  },

  // 接收 H5 页面通过 wx.miniProgram.postMessage 发送的消息
  onWebMessage(e) {
    const msg = e?.detail?.data
    if (!Array.isArray(msg) || !msg.length) return
    const latest = msg[msg.length - 1]
    if (latest?.type === 'openWorkBuddy') {
      openWorkBuddy(latest.prompt || '')
      return
    }
    if (latest?.type === 'share') {
      this.setData({
        shareTitle: latest.title || this.data.shareTitle,
        shareDesc: latest.desc || this.data.shareDesc,
        sharePath: latest.url || this.data.sharePath,
        shareImageUrl: latest.imageUrl || this.data.shareImageUrl
      })
    }
  },

  // 微信小程序原生分享
  onShareAppMessage() {
    const { shareTitle, shareDesc, sharePath, shareImageUrl } = this.data
    const app = getApp()
    const path = sharePath || app.globalData.gameUrl || 'pages/index/index'
    return {
      title: shareTitle,
      desc: shareDesc,
      path,
      imageUrl: shareImageUrl || undefined
    }
  },

  onWebLoad() {
    // 网页加载完成后再移除遮罩，避免出现白屏
    this._clearTimer()
    this.setData({ loading: false, retryCount: 0 })
  },

  onError(e) {
    this._clearTimer()
    this.setData({ loading: false })
    console.error('web-view 加载失败', e.detail)
    wx.showModal({
      title: '加载失败',
      content: '请检查网络或在小程序后台确认 keepwork.com 已配置为业务域名',
      confirmText: '重试',
      cancelText: '返回',
      success: (res) => {
        if (res.confirm) {
          this.setData({ retryCount: 0 })
          this._loadWebView()
        } else {
          wx.navigateBack()
        }
      }
    })
  }
})
