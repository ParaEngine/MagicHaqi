// 中文文案
export const zhCN = {
    appName: '魔法哈奇',
    tagline: '蛋蛋星球',

    // 通用
    login: '登录',
    logout: '退出登录',
    cancel: '取消',
    confirm: '确定',
    back: '返回',
    save: '保存',
    delete: '删除',
    loading: '加载中…',
    coins: '金币',

    // 登录
    pleaseLogin: '请先登录开始领养第一只宠物蛋',
    loggingIn: '登录中…',

    // 宠物列表
    myPets: '我的宠物',
    petList: '宠物列表',
    switchPet: '宠物列表',
    hatchNew: '🥚 孵化新蛋',
    breedNew: '💕 繁殖宝宝',
    noPets: '还没有宠物，孵化你的第一只吧！',

    // 孵化
    hatchTitle: '孵化新宠物',
    seedDna: 'DNA 种子（可选）',
    randomDna: '🎲 随机 DNA',
    petName: '宠物名字',
    namePlaceholder: '给它起个名字…',
    generate: '✨ AI 生成立绘',
    generating: '正在生成中，请稍候…',
    chooseParents: '选择父母',
    breed: '繁殖',
    parent1: '爸爸',
    parent2: '妈妈',
    samePetError: '不能选择同一只宠物',
    needAdult: '只有成年及以上的宠物可以繁殖',

    // 主家
    homeTitle: '我的家',
    actionFeed: '🍖 喂食',
    actionBath: '🛁 洗澡',
    actionPlay: '🎾 玩耍',
    actionSleep: '😴 睡觉',
    actionStudy: '📚 学习',
    actionHeal: '💊 看病',
    decorate: '🛠 装饰',
    exitDecor: '✓ 完成',
    rooms: '房间',

    // 状态
    statHunger: '饥饿',
    statMood: '心情',
    statClean: '清洁',
    statEnergy: '体力',
    statHealth: '健康',
    statIntel: '智力',
    statBond: '亲密',

    // 商店/背包
    shop: '商店',
    inventory: '背包',
    buy: '购买',
    notEnoughCoins: '金币不足',
    bought: '购买成功！',
    placedToRoom: '已放入房间',

    // 聊天
    chat: '聊天',
    help: '帮助',
    chatPlaceholder: '说点什么…',
    send: '发送',
    voiceChat: '🎙 语音对话',
    voiceVip: '语音对话仅限 VIP',
    petThinking: '正在思考…',

    // 档案
    profile: '档案',
    dnaCode: 'DNA 编码',
    stage: '成长阶段',
    bornAt: '诞生时间',
    parents: '父母',
    memory: '记忆',
    noMemory: '暂无记忆，多和它聊聊吧～',

    // 设置
    settings: '设置',
    devVip: '开发者：VIP 模式',
    clearData: '清除本机数据',
    clearConfirm: '确定清除所有本机数据？此操作不可恢复！',
    cleared: '已清除',
};

let _lang = zhCN;
export function t(key) { return _lang[key] || key; }
