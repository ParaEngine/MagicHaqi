const app = getApp()
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
          wx.showToast({ title: '已复制提示词，请手动打开 WorkBuddy', icon: 'none' })
        }
      })
    },
    fail(err) {
      console.error('复制 WorkBuddy 提示词失败', err)
      wx.showToast({ title: '复制提示词失败', icon: 'none' })
    }
  })
}

Page({
  data: {
    url: ''
  },

  _lastImportGameDraft: '',

  onLoad(options) {
    const importGameDraft = getImportGameDraft(options || {})
    if (importGameDraft) this._lastImportGameDraft = importGameDraft
    const suffix = importGameDraft ? '?importGameDraft=' + encodeURIComponent(importGameDraft) : ''
    this.setData({
      url: app.globalData.gameUrl + suffix
    })
  },

  onShow() {
    const importGameDraft = getImportGameDraft()
    if (!importGameDraft) return
    if (this._lastImportGameDraft === importGameDraft) return
    this._lastImportGameDraft = importGameDraft
    this.setData({
      url: app.globalData.gameUrl + '?importGameDraft=' + encodeURIComponent(importGameDraft) + '&_t=' + Date.now()
    })
  },

  onWebMessage(e) {
    const msg = e?.detail?.data
    if (!Array.isArray(msg) || !msg.length) return
    const latest = msg[msg.length - 1]
    if (latest?.type === 'openWorkBuddy') openWorkBuddy(latest.prompt || '')
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
