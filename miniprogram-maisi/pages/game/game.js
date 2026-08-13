const app = getApp()
const WORKBUDDY_APP_ID = 'wx907c65e5e107ddcf'
const GROWTH_BASE_URL = 'https://magic-haqi-growth.pages.dev'
const GROWTH_MOBILE_CHANNEL = 'haqi.growth.mobile.v1'
const GROWTH_MESSAGE_TYPES = new Set(['gameLoaded', 'gameStarted', 'gameFinished', 'growthStatus'])
const GROWTH_PARAMS = {
  student: ['studentSite', 'studentId', 'studentAccount'],
  guardian: ['guardianSite', 'guardianClass', 'guardianStudent', 'guardianName', 'guardianTeacher']
}

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

function getGrowthLaunch(options = {}) {
  const extra = getReferrerExtraData()
  const source = { ...extra, ...options }
  const inferredRole = source.guardianSite ? 'guardian' : source.studentSite ? 'student' : ''
  const role = String(source.growthRole || inferredRole).toLowerCase()
  if (!['teacher', 'student', 'guardian'].includes(role)) return null
  const page = role === 'guardian' ? 'haqi_growth_guardian_c.html' : 'haqi_personal_pet_points_c.html'
  const params = [
    `growthRole=${encodeURIComponent(role)}`,
    'host=wechat-miniprogram',
    `channel=${encodeURIComponent(GROWTH_MOBILE_CHANNEL)}`
  ]
  for (const key of GROWTH_PARAMS[role] || []) {
    if (source[key]) params.push(`${key}=${encodeURIComponent(String(source[key]))}`)
  }
  return `${GROWTH_BASE_URL}/${page}?${params.join('&')}`
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
    const growthUrl = getGrowthLaunch(options || {})
    if (growthUrl) {
      this._growthUrl = growthUrl
      this.setData({ url: growthUrl })
      return
    }
    const importGameDraft = getImportGameDraft(options || {})
    if (importGameDraft) this._lastImportGameDraft = importGameDraft
    const suffix = importGameDraft ? '?importGameDraft=' + encodeURIComponent(importGameDraft) : ''
    this.setData({
      url: app.globalData.gameUrl + suffix
    })
  },

  onShow() {
    if (this._growthUrl) return
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
    if (latest?.channel === GROWTH_MOBILE_CHANNEL && GROWTH_MESSAGE_TYPES.has(latest.type)) {
      this._growthProtocolState = { type: latest.type, data: latest.data || {}, receivedAt: Date.now() }
      if (latest.type === 'gameFinished') wx.showToast({ title: '成长任务已记录', icon: 'none' })
      return
    }
    if (latest?.type === 'openWorkBuddy') openWorkBuddy(latest.prompt || '')
  },

  onWebLoad() {
    this._growthProtocolState ||= { type: 'webLoaded', data: {}, receivedAt: Date.now() }
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
