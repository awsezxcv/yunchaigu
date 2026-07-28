const STORAGE_KEY = 'online-chaigu-tool-v2'
const PALETTE = ['#F7235F', '#ED38AA', '#1F4EEA', '#7394FF', '#2FE1C3', '#50DB7A', '#B6825D', '#1EF61A', '#F0CF2D', '#ED9333', '#FF6969', '#DC2424']

function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
function createPlan(title = '点我打开方案配置') {
  return { id: createId(), title, noRepeat: false, options: ['徽章', '立牌', '色纸', '挂件', '明信片', '隐藏款'].map(name => ({ id: createId(), name, weight: 1, selected: false })) }
}
function normalizePlan(plan) {
  const fallback = createPlan()
  return { ...fallback, ...plan, id: plan.id || createId(), options: plan.options && plan.options.length ? plan.options : fallback.options }
}
function loadWorkspace() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY)
    if (saved && saved.plans && saved.plans.length) {
      const plans = saved.plans.map(normalizePlan)
      const history = Array.isArray(saved.history) ? saved.history.filter(item => item && item.result).slice(0, 100) : []
      return { plans, activePlanId: plans.some(plan => plan.id === saved.activePlanId) ? saved.activePlanId : plans[0].id, history }
    }
  } catch (error) {}
  const plan = createPlan()
  return { plans: [plan], activePlanId: plan.id, history: [] }
}
function formatHistoryTime(timestamp) {
  const date = new Date(timestamp)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function tintColor(hex) {
  const color = Number.parseInt(hex.slice(1), 16)
  const channel = shift => Math.round(255 - (255 - ((color >> shift) & 255)) * 0.16)
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}
function flipEase(progress) {
  let low = 0
  let high = 1
  for (let index = 0; index < 8; index += 1) {
    const time = (low + high) / 2
    const inverse = 1 - time
    const x = 3 * inverse * inverse * time * 0.2 + 3 * inverse * time * time * 0.2 + time * time * time
    if (x < progress) low = time
    else high = time
  }
  const time = (low + high) / 2
  const inverse = 1 - time
  return 3 * inverse * inverse * time * 0.8 + 3 * inverse * time * time + time * time * time
}
function normalizeRotation(rotation) {
  return ((rotation % 360) + 360) % 360
}

Page({
  data: { plans: [], plan: {}, history: [], activeCount: 0, totalWeight: 0, cardColor: PALETTE[0], cardBackColor: tintColor(PALETTE[0]), cardAngle: 0, resultText: '准备好了', hint: '', hasResult: false, shakeClass: '', panelOpen: false, panelClosing: false, panelMode: 'editor', historyOpen: false, historyClosing: false },
  onLoad() { this.workspace = loadWorkspace(); this.hasResult = false; this.cardRotation = 0; this.drawVersion = 0; this.shakeVersion = 0; this.shakeCycle = 0; this.flipAnimation = null; this.resultTimer = null; this.shakeTimer = null; this.saveTimer = null; this.render() },
  onHide() { if (this.shakeTimer) { clearTimeout(this.shakeTimer); this.shakeTimer = null } if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; this.save() } },
  save() { wx.setStorageSync(STORAGE_KEY, this.workspace) },
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      wx.setStorage({ key: STORAGE_KEY, data: this.workspace })
    }, 250)
  },
  currentPlan() { return this.workspace.plans.find(plan => plan.id === this.workspace.activePlanId) },
  activeOptions() {
    const plan = this.currentPlan()
    return plan.options.filter(option => option.name.trim() && Number(option.weight) > 0 && (!plan.noRepeat || !option.selected))
  },
  random(max) {
    return Math.floor(Math.random() * max)
  },
  hydratePlan(plan) {
    const total = plan.options.reduce((sum, option) => sum + (option.name.trim() ? Number(option.weight) || 0 : 0), 0)
    return { ...plan, validCount: plan.options.filter(option => option.name.trim() && Number(option.weight) > 0).length, options: plan.options.map(option => ({ ...option, probability: total ? `${((Number(option.weight) / total) * 100).toFixed((Number(option.weight) / total) * 100 >= 10 ? 0 : 1)}%` : '0%' })) }
  },
  render() {
    const plan = this.hydratePlan(this.currentPlan())
    const activeCount = this.activeOptions().length
    const totalWeight = plan.options.reduce((sum, option) => sum + (option.name.trim() ? Number(option.weight) || 0 : 0), 0)
    this.setData({ plans: this.workspace.plans.map(item => this.hydratePlan(item)), plan, history: this.workspace.history.map(item => ({ ...item, displayTime: formatHistoryTime(item.timestamp) })), activeCount, totalWeight, hasResult: this.hasResult, hint: this.hasResult ? (plan.noRepeat ? '结果已从后续抽取中移除' : '再次点击卡片，重新随机抽取') : (activeCount >= 2 ? '点击卡片，随机揭晓一个结果' : '请在设置中保留至少 2 个有效选项') })
  },
  currentCardRotation() {
    if (!this.flipAnimation) return normalizeRotation(this.cardRotation)
    const progress = Math.min(1, (Date.now() - this.flipAnimation.startedAt) / this.flipAnimation.duration)
    return normalizeRotation(this.flipAnimation.start + (this.flipAnimation.end - this.flipAnimation.start) * flipEase(progress))
  },
  draw() {
    const drawVersion = ++this.drawVersion
    this.shakeVersion += 1
    if (this.resultTimer) clearTimeout(this.resultTimer)
    if (this.shakeTimer) clearTimeout(this.shakeTimer)
    this.shakeTimer = null
    if (this.data.shakeClass) this.setData({ shakeClass: '' })
    const startRotation = this.currentCardRotation()
    const candidates = this.activeOptions()
    const total = candidates.reduce((sum, option) => sum + Number(option.weight), 0)
    if (candidates.length < 2 || !total) { this.openEditor(); return }
    let cursor = this.random(total)
    const picked = candidates.find(option => (cursor -= Number(option.weight)) < 0) || candidates[candidates.length - 1]
    if (this.currentPlan().noRepeat) picked.selected = true
    const choices = PALETTE.filter(color => color !== this.data.cardColor)
    const color = choices[this.random(choices.length)]
    const endRotation = this.hasResult ? 540 : 180
    this.cardRotation = endRotation
    this.hasResult = true
    const plan = this.currentPlan()
    const activeCount = this.activeOptions().length
    this.scheduleSave()
    this.setData({
      activeCount,
      hasResult: true,
      cardAngle: startRotation,
      hint: plan.noRepeat ? '结果已从后续抽取中移除' : '再次点击卡片，重新随机抽取',
      cardColor: color,
      cardBackColor: tintColor(color)
    }, () => {
      if (drawVersion !== this.drawVersion) return
      this.clearAnimation('#card-inner', { rotateY: true }, () => {
        if (drawVersion !== this.drawVersion) return
        this.flipAnimation = { start: startRotation, end: endRotation, startedAt: Date.now(), duration: 200 }
        this.animate('#card-inner', [
          { offset: 0, rotateY: startRotation, ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          { offset: 1, rotateY: endRotation }
        ], 200, () => {
          if (drawVersion === this.drawVersion) this.flipAnimation = null
        })
        const resultTimer = setTimeout(() => {
          if (drawVersion === this.drawVersion) {
            this.workspace.history.unshift({ id: createId(), result: picked.name, planTitle: plan.title || '未命名方案', timestamp: Date.now() })
            if (this.workspace.history.length > 100) this.workspace.history.length = 100
            this.setData({ resultText: picked.name, history: this.workspace.history.map(item => ({ ...item, displayTime: formatHistoryTime(item.timestamp) })) })
            this.scheduleSave()
          }
          if (this.resultTimer === resultTimer) this.resultTimer = null
        }, 100)
        this.resultTimer = resultTimer
      })
    })
  },
  shuffle() {
    const shakeVersion = ++this.shakeVersion
    const shakeClass = ++this.shakeCycle % 2 ? 'is-shaking-a' : 'is-shaking-b'
    const options = this.currentPlan().options
    for (let index = options.length - 1; index > 0; index -= 1) { const other = this.random(index + 1); [options[index], options[other]] = [options[other], options[index]] }
    this.drawVersion += 1
    if (this.resultTimer) clearTimeout(this.resultTimer)
    if (this.shakeTimer) clearTimeout(this.shakeTimer)
    this.resultTimer = null
    this.shakeTimer = null
    this.flipAnimation = null
    this.clearAnimation('#card-inner', { rotateY: true })
    this.cardRotation = 0
    this.hasResult = false
    const activeCount = this.activeOptions().length
    const color = PALETTE[this.random(PALETTE.length)]
    this.scheduleSave()
    this.setData({
      resultText: '准备好了',
      hasResult: false,
      cardAngle: 0,
      shakeClass,
      activeCount,
      hint: activeCount >= 2 ? '点击卡片，随机揭晓一个结果' : '请在设置中保留至少 2 个有效选项',
      cardColor: color,
      cardBackColor: tintColor(color)
    }, () => {
      if (shakeVersion !== this.shakeVersion) return
      const shakeTimer = setTimeout(() => {
        if (shakeVersion === this.shakeVersion) this.setData({ shakeClass: '' })
        if (this.shakeTimer === shakeTimer) this.shakeTimer = null
      }, 300)
      this.shakeTimer = shakeTimer
    })
  },
  openEditor() { if (this.panelCloseTimer) { clearTimeout(this.panelCloseTimer); this.panelCloseTimer = null } this.setData({ panelOpen: true, panelClosing: false, panelMode: 'editor' }); this.render() },
  openPlanManager() { if (this.panelCloseTimer) { clearTimeout(this.panelCloseTimer); this.panelCloseTimer = null } this.setData({ panelOpen: true, panelClosing: false, panelMode: 'plans' }); this.render() },
  openHistory() { if (this.historyCloseTimer) { clearTimeout(this.historyCloseTimer); this.historyCloseTimer = null } this.setData({ historyOpen: true, historyClosing: false }) },
  closePanel() {
    if (!this.data.panelOpen) return
    if (this.panelCloseTimer) clearTimeout(this.panelCloseTimer)
    this.setData({ panelClosing: true }, () => {
      const panelCloseTimer = setTimeout(() => {
        if (this.panelCloseTimer !== panelCloseTimer) return
        this.panelCloseTimer = null
        this.setData({ panelOpen: false, panelClosing: false })
      }, 100)
      this.panelCloseTimer = panelCloseTimer
    })
  }, stopPropagation() {},
  closeHistory() {
    if (!this.data.historyOpen) return
    if (this.historyCloseTimer) clearTimeout(this.historyCloseTimer)
    this.setData({ historyClosing: true }, () => {
      const historyCloseTimer = setTimeout(() => {
        if (this.historyCloseTimer !== historyCloseTimer) return
        this.historyCloseTimer = null
        this.setData({ historyOpen: false, historyClosing: false })
      }, 100)
      this.historyCloseTimer = historyCloseTimer
    })
  },
  selectPlan(event) { this.workspace.activePlanId = event.currentTarget.dataset.id; this.clearAnimation('#card-inner'); this.cardRotation = 0; this.hasResult = false; this.setData({ resultText: '准备好了', cardAngle: 0 }); this.save(); this.render(); this.closePanel() },
  editPlan(event) { this.workspace.activePlanId = event.currentTarget.dataset.id; this.clearAnimation('#card-inner'); this.cardRotation = 0; this.hasResult = false; this.setData({ panelMode: 'editor', resultText: '准备好了', cardAngle: 0 }); this.save(); this.render() },
  createPlan() { const plan = createPlan('新方案'); this.workspace.plans.push(plan); this.workspace.activePlanId = plan.id; this.clearAnimation('#card-inner'); this.cardRotation = 0; this.hasResult = false; this.setData({ panelMode: 'editor', resultText: '准备好了', cardAngle: 0 }); this.save(); this.render() },
  deletePlan(event) {
    if (this.workspace.plans.length === 1) return
    const targetPlan = this.workspace.plans.find(plan => plan.id === event.currentTarget.dataset.id)
    if (!targetPlan) return
    wx.showModal({ title: '删除方案', content: `删除方案“${targetPlan.title || '未命名方案'}”？`, success: result => { if (result.confirm) { const deletingActive = targetPlan.id === this.workspace.activePlanId; this.workspace.plans = this.workspace.plans.filter(plan => plan.id !== targetPlan.id); if (deletingActive) { this.workspace.activePlanId = this.workspace.plans[0].id; this.clearAnimation('#card-inner'); this.cardRotation = 0; this.hasResult = false; this.setData({ resultText: '准备好了', cardAngle: 0 }) } this.save(); this.render() } } })
  },
  changeTitle(event) { this.currentPlan().title = event.detail.value; this.save(); this.render() },
  toggleNoRepeat(event) { const plan = this.currentPlan(); plan.noRepeat = event.detail.value; if (!plan.noRepeat) plan.options.forEach(option => { option.selected = false }); this.save(); this.render() },
  changeOption(event) { const plan = this.currentPlan(); const option = plan.options.find(item => item.id === event.currentTarget.dataset.id); if (!option) return; const { field } = event.currentTarget.dataset; option[field] = field === 'weight' ? Math.max(1, Math.min(9999, Number(event.detail.value) || 1)) : event.detail.value; this.save(); this.render() },
  sortOptions() { this.currentPlan().options.sort((left, right) => { const leftName = left.name.trim(); const rightName = right.name.trim(); if (!leftName) return rightName ? 1 : 0; if (!rightName) return -1; return leftName.localeCompare(rightName, 'zh-Hans-CN') }); this.save(); this.render() },
  addOption() { this.currentPlan().options.push({ id: createId(), name: '', weight: 1, selected: false }); this.save(); this.render() },
  deleteOption(event) { const plan = this.currentPlan(); if (plan.options.length <= 2) return; plan.options = plan.options.filter(option => option.id !== event.currentTarget.dataset.id); this.save(); this.render() },
  onShareAppMessage() { return { title: '在线拆谷工具', path: '/pages/index/index' } },
  onShareTimeline() { return { title: '在线拆谷工具' } }
})
