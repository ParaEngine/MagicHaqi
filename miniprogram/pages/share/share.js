const app = getApp()

function decode(v) {
  if (!v) return ''
  try {
    return decodeURIComponent(v)
  } catch (e) {
    return v
  }
}

Page({
  data: {
    title: '蛋蛋星球 MagicHaqi',
    desc: '快来玩我做的小游戏！',
    icon: '🎮',
    gameFrom: '',
    game: '',
    msg: '',
    imageUrl: ''
  },

  // canvas 生成的分享封面临时图片路径
  _shareImagePath: '',

  onLoad(options) {
    this.setData({
      title: decode(options.title) || this.data.title,
      desc: decode(options.desc) || this.data.desc,
      icon: decode(options.icon) || this.data.icon,
      gameFrom: decode(options.gameFrom),
      game: decode(options.game),
      msg: decode(options.msg),
      imageUrl: decode(options.imageUrl)
    })
    // 允许从右上角菜单转发
    wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
    // 提前画好分享封面，等用户点分享时直接用
    this._renderShareCover()
  },

  // 用 canvas 画一张 5:4 的分享封面图（渐变背景 + 图标 + 标题）
  _renderShareCover() {
    // 已传入网络封面图就不用再画
    if (this.data.imageUrl) return
    const query = wx.createSelectorQuery()
    query.select('#shareCanvas').fields({ node: true, size: true }).exec((res) => {
      const node = res && res[0] && res[0].node
      if (!node) return
      const canvas = node
      const ctx = canvas.getContext('2d')
      const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2
      const W = 500
      const H = 400
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)

      // 背景渐变
      const bg = ctx.createLinearGradient(0, 0, W, H)
      bg.addColorStop(0, '#2a3a6e')
      bg.addColorStop(0.5, '#16213e')
      bg.addColorStop(1, '#0f1830')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      // 图标徽章
      const badge = ctx.createLinearGradient(W / 2 - 60, 70, W / 2 + 60, 190)
      badge.addColorStop(0, 'rgba(249,168,38,0.30)')
      badge.addColorStop(1, 'rgba(255,95,162,0.30)')
      ctx.fillStyle = badge
      this._roundRect(ctx, W / 2 - 60, 70, 120, 120, 28)
      ctx.fill()

      // 图标 emoji
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '76px sans-serif'
      ctx.fillText(this.data.icon || '🎮', W / 2, 132)

      // 标题（最多两行，超出省略）
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 34px sans-serif'
      this._drawWrappedText(ctx, this.data.title, W / 2, 220, W - 80, 44, 2)

      // 来源信息（gameFrom）
      let infoY = 310
      if (this.data.gameFrom) {
        ctx.fillStyle = '#a8b4d8'
        ctx.font = '22px sans-serif'
        ctx.fillText(this.data.gameFrom + ' 给你分享了一个小游戏', W / 2, infoY)
        infoY += 36
      }

      // 游戏名称（game）
      if (this.data.game) {
        ctx.fillStyle = '#f9a826'
        ctx.font = 'bold 20px sans-serif'
        const gameLabel = '🎮 ' + this.data.game.replace('.html', '').replace('game-', '')
        ctx.fillText(gameLabel, W / 2, infoY)
        infoY += 32
      }

      // 留言（msg）
      if (this.data.msg) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.font = '24px sans-serif'
        // 圆角气泡背景
        const msgW = Math.min(ctx.measureText(this.data.msg).width + 40, W - 100)
        const msgX = W / 2 - msgW / 2
        this._roundRect(ctx, msgX, infoY + 8, msgW, 38, 10)
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillText(this.data.msg, W / 2, infoY + 30)
      }

      wx.canvasToTempFilePath({
        canvas,
        success: (r) => { this._shareImagePath = r.tempFilePath },
        fail: (e) => { console.warn('生成分享封面失败', e) }
      })
    })
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  },

  // 居中绘制可换行文本，超过 maxLines 行末尾加省略号
  _drawWrappedText(ctx, text, centerX, startY, maxWidth, lineHeight, maxLines) {
    const chars = String(text || '').split('')
    const lines = []
    let line = ''
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i]
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = chars[i]
        if (lines.length === maxLines) break
      } else {
        line = test
      }
    }
    if (lines.length < maxLines && line) lines.push(line)
    if (lines.length === maxLines) {
      let last = lines[maxLines - 1]
      while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1)
      // 若原文本还有剩余，补省略号
      if (chars.length && lines.join('').length < chars.length) lines[maxLines - 1] = last + '…'
    }
    lines.forEach((l, idx) => {
      ctx.fillText(l, centerX, startY + idx * lineHeight)
    })
  },

  // 把分享来源/游戏标识拼进被分享游戏的打开路径，接收方点开后直达该游戏
  _buildSharePath() {
    const params = []
    if (this.data.gameFrom) params.push('gameFrom=' + encodeURIComponent(this.data.gameFrom))
    if (this.data.game) params.push('game=' + encodeURIComponent(this.data.game))
    if (this.data.msg) params.push('msg=' + encodeURIComponent(this.data.msg))
    const query = params.length ? '?' + params.join('&') : ''
    return 'pages/game/game' + query
  },

  // 用户点击原生分享按钮 / 右上角菜单转发时触发
  onShareAppMessage() {
    return {
      title: this.data.title,
      path: this._buildSharePath(),
      imageUrl: this._shareImagePath || this.data.imageUrl || undefined,
      desc: this.data.desc
    }
  },

  onBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/game/game' })
      }
    })
  }
})
