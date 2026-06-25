# Shop Item Ideas / Existing Items

本文档用于给后续 LLM 生成新的商店物品时避重。下面列出的都是 `_default_shopitems.json` 中已经存在的物品；生成新物品时应避免重复相同名称、相同功能定位、相同场景用途或过近的视觉概念。

## 生成新物品时的避重原则

- 不要重复已有 `id`、中文名、emoji 主意或同义替换名称，例如已有“台灯”，就不要生成“桌灯/小台灯”。
- 同一房间内避免继续扩展过多基础家具，优先补充互动装置、主题套装、星球生态设施或有特殊效果的物品。
- 食物类若新增，应明确 `foodKind`、数值效果和可能影响的 trait，避免只是换皮的饱腹食物。
- 户外生态类应区分 `land`、`water`、`sky`、`fire`、`ice`、`life`、`dark` 等 field，避免重复已有站点、房屋、交通、桥梁、医院、商店等功能。
- 房屋类已有 1 到 5 间基础升级线，新房屋应是主题屋、生态屋或特殊玩法屋，而不是继续增加普通“几间房”。

## 食物 Food

### 基础饲料

- `food_basic_feed` 原始饲料 🌿：免费、隐藏、无限；hunger +22；成年阶段有 mood penalty；通用食性。
- `food_large_feed` 大型饲料 🍱：price 16；hunger +45；成年阶段有 mood penalty；通用食性。

### 情绪与通用零食

- `food_cookie` 开心饼干 🍪：price 10；hunger +8、mood +8；通用食性。
- `food_pudding` 蜂蜜布丁 🍮：price 16；hunger +12、mood +14；通用食性。
- `food_milk` 温牛奶 🥛：price 14；hunger +14、mood +10；通用食性。
- `food_party` 欢乐套餐 🥞：price 28；hunger +18、mood +22、bond +2；通用食性。

### Trait 食物

- `food_apple` 红苹果 🍎：price 5；vegetables；hunger +15；trait `fruitLike`。
- `food_meat` 烤肉 🥩：price 12；meat；hunger +30；trait `catLike`。
- `food_cake` 蛋糕 🍰：price 18；vegetables；hunger +20、mood +10；trait `sweetLike`。
- `food_carrot` 胡萝卜 🥕：price 8；vegetables；hunger +18；trait `rabbitLike`。
- `food_fish` 小鱼干 🐟：price 14；meat；hunger +28；trait `fishLike`。
- `food_seed` 麦穗 🌾：price 6；vegetables；hunger +12、mood +4；trait `birdLike`。
- `food_chili` 火焰椒 🌶️：price 20；vegetables；hunger +28；trait `dragonLike`。

### 阶段特殊药丸

- `food_growth_pill` 快速长大药丸 💊：price 1000；hunger +6、mood +4；specialStageEffect `grow`。
- `food_youth_pill` 返老还童药丸 🧪：price 1000；hunger +6、mood +4；specialStageEffect `rejuvenate`。

## 玩具 Toy

- `toy_ball` 皮球 ⚽：price 35；mood +12。
- `toy_drum` 小鼓 🥁：price 50；mood +14。

## 室内通用家具 Indoor Furniture

这些物品的 `fields` 多为 `indoor`，属于全室内通用装饰或基础家具。

- `furn_bed` 小床 🛏️：price 54；fieldSize 1.6。
- `furn_sofa` 沙发 🛋️：price 64；fieldSize 1.8。
- `furn_lamp` 台灯 💡：price 24；fieldSize 1。
- `furn_plant` 盆栽 🪴：price 30；fieldSize 1。
- `furn_tv` 电视 📺：price 98；fieldSize 1.6。
- `furn_table` 小桌 🪑：price 36；fieldSize 1.3。
- `furn_picture` 装饰画 🖼️：price 30；fieldSize 1。
- `furn_clock` 挂钟 🕰️：price 36；fieldSize 1。
- `furn_bath` 浴缸 🛁：price 76；fieldSize 1.6。
- `furn_fridge` 冰箱 🧊：price 88；fieldSize 1。
- `deco_wardrobe` 衣柜 🚪：price 64；fieldSize 1.2。
- `deco_bookshelf` 书架 📚：price 64；fieldSize 1.3。
- `deco_desk` 书桌 🪑：price 54；fieldSize 1.6。
- `deco_chair` 椅子 🪑：price 30；fieldSize 1。
- `deco_rug` 地毯 🟦：price 36；fieldSize 2。
- `deco_mirror` 镜子 🪞：price 44；fieldSize 1。
- `deco_window` 窗户 🪟：price 44；fieldSize 1.2。
- `deco_door` 小门 🚪：price 54；fieldSize 1。
- `deco_cabinet` 橱柜 🗄️：price 54；fieldSize 1.4。
- `deco_sink` 水槽 🚰：price 44；fieldSize 1.4。
- `deco_toilet` 马桶 🚽：price 64；fieldSize 1.2。
- `deco_stove` 炉灶 🔥：price 76；fieldSize 1.4。
- `deco_microwave` 微波炉 📦：price 44；fieldSize 1.3。
- `deco_curtains` 窗帘 🎀：price 30；fieldSize 1.4。
- `deco_computer` 电脑 💻：price 98；fieldSize 1.4。
- `deco_piano` 钢琴 🎹：price 108；fieldSize 1.8。
- `deco_vase` 花瓶 🏺：price 30；fieldSize 1。
- `deco_candle` 蜡烛 🕯️：price 24；fieldSize 1。
- `deco_nightstand` 床头柜 🗄️：price 36；fieldSize 1。
- `deco_dresser` 斗柜 🗄️：price 54；fieldSize 1.4。
- `deco_aquarium` 鱼缸 🐠：price 88；fieldSize 1.6。
- `deco_fireplace` 壁炉 🔥：price 98；fieldSize 1.6。
- `deco_fan` 风扇 🌀：price 36；fieldSize 1.1。
- `deco_aircon` 空调 ❄️：price 76；fieldSize 1.6。
- `deco_trash_bin` 垃圾桶 🗑️：price 18；fieldSize 1。
- `deco_toy_box` 玩具箱 🧸：price 44；fieldSize 1.4。
- `deco_beanbag` 懒人沙发 🛋️：price 54；fieldSize 1.4。
- `deco_floor_mat` 脚垫 🟨：price 24；fieldSize 1.6。
- `deco_shelf` 置物架 🧺：price 36；fieldSize 1.3。
- `deco_coat_rack` 衣帽架 🧥：price 36；fieldSize 1。

## 房间专属家具 Room Furniture

### Bedroom 卧室

- `bed_pillow` 枕头 🛏️：price 18；fieldSize 1。
- `bed_blanket` 毛毯 🛌：price 24；fieldSize 1.6。
- `bed_alarm_clock` 闹钟 ⏰：price 24；fieldSize 1。
- `bed_slippers` 拖鞋 🥿：price 18；fieldSize 1.2。
- `bed_vanity` 梳妆台 🪞：price 64；fieldSize 1.4。
- `bed_canopy` 床幔 🎀：price 54；fieldSize 1.8。
- `bed_wall_shelf` 床边架 📚：price 36；fieldSize 1.4。
- `bed_dream_lamp` 梦境灯 🌙：price 36；fieldSize 1。

### Kitchen 厨房

- `kit_counter` 料理台 🥣：price 64；fieldSize 1.8。
- `kit_cupboard` 碗柜 🍽️：price 54；fieldSize 1.3。
- `kit_teapot` 茶壶 🫖：price 24；fieldSize 1。
- `kit_cutting_board` 砧板 🔪：price 24；fieldSize 1.2。
- `kit_pot_rack` 锅具架 🍳：price 44；fieldSize 1.5。
- `kit_spice_shelf` 调料架 🧂：price 30；fieldSize 1.3。
- `kit_oven` 烤箱 🔥：price 76；fields `kitchen`, `fire`；fieldSize 1.4。
- `kit_bar_stool` 吧台椅 🪑：price 36；fieldSize 1。

### Bath 浴室

- `bath_towel_rack` 毛巾架 🧻：price 30；fieldSize 1.3。
- `bath_shower` 花洒 🚿：price 54；fieldSize 1.2。
- `bath_basin` 洗脸盆 🧼：price 44；fieldSize 1.3。
- `bath_soap_dish` 香皂盒 🧼：price 18；fieldSize 1。
- `bath_scale` 体重秤 ⚖️：price 30；fieldSize 1。
- `bath_bath_mat` 浴室垫 🟦：price 24；fieldSize 1.4。
- `bath_toothbrush_cup` 牙刷杯 🪥：price 18；fieldSize 1。
- `bath_medicine_cabinet` 药柜 💊：price 54；fieldSize 1.2。
- `bath_bubble_tub` 泡泡桶 🫧：price 36；fieldSize 1.2。

### Living 客厅

- `living_coffee_table` 茶几 ☕：price 44；fieldSize 1.5。
- `living_speaker` 音箱 🔊：price 54；fieldSize 1。
- `living_game_console` 游戏机 🎮：price 76；fieldSize 1.2。
- `living_wall_art` 客厅画 🖼️：price 36；fieldSize 1.2。
- `living_magazine_rack` 杂志架 📰：price 30；fieldSize 1。
- `living_projector` 投影仪 🎬：price 88；fieldSize 1.2。

### Garden 花园

- `garden_bench` 长椅 🪑：price 54；fieldSize 1.6。
- `garden_swing` 秋千 🛝：price 76；fieldSize 1.6。
- `garden_birdhouse` 鸟屋 🐦：price 36；fieldSize 1。
- `garden_watering_can` 水壶 🚿：price 24；fieldSize 1.2。
- `garden_path_tiles` 小路砖 🧱：price 30；fieldSize 1.8。
- `garden_flower_bed` 花坛 🌷：price 44；fieldSize 1.6。
- `garden_picnic_table` 野餐桌 🧺：price 64；fieldSize 1.7。
- `garden_lantern` 庭院灯 🏮：price 36；fieldSize 1。
- `garden_fence` 小围栏 🪵：price 30；fieldSize 1.8。
- `garden_hammock` 吊床 🏕️：price 64；fieldSize 1.8。

### 跨房间家具

- `bed_laundry_basket` 脏衣篮 🧺：fields `bedroom`, `bath`；price 30；fieldSize 1.1。
- `kit_dining_set` 餐具组 🍽️：fields `kitchen`, `living`；price 36；fieldSize 1.3。
- `living_books` 书堆 📚：fields `living`, `bedroom`；price 24；fieldSize 1。
- `living_floor_lamp` 落地灯 💡：fields `living`, `bedroom`；price 44；fieldSize 1。
- `bed_plush_bear` 玩偶熊 🧸：fields `bedroom`, `living`；price 30；fieldSize 1。
- `kit_fruit_bowl` 果盘 🍎：fields `kitchen`, `living`；price 24；fieldSize 1.1。
- `bath_hamper` 浴衣篮 🧺：fields `bath`, `bedroom`；price 30；fieldSize 1。
- `living_plant_stand` 花架 🪴：fields `living`, `garden`；price 44；fieldSize 1。
- `living_pet_cushion` 宠物垫 🐾：fields `living`, `bedroom`；price 30；fieldSize 1.3。

## 户外与星球生态 Outdoor / Planet Fields

### Outdoor 通用户外

- `field_flower` 服务站 🏪：fields `outdoor`；price 44；fieldSize 1.2。

### Land 陆地

- `land_tent` 帐篷 ⛺：type `house`；fields `land`；rooms `bedroom`；price 96；uniqueItem；fieldSize 1.25。
- `land_mushroom` 医护站 🏥：fields `land`；price 88；fieldSize 1.45。
- `land_stone` 路标站 🪧：fields `land`；price 36；fieldSize 1。
- `land_school` 小学校 🏫：fields `land`；price 88；fieldSize 1.55。
- `land_market` 小商店 🏪：fields `land`；price 64；fieldSize 1.25。

### Water 水域

- `water_coral` 水上医院 🏥：fields `water`；price 76；fieldSize 1.45。
- `water_shell` 小码头 ⚓：fields `water`；price 54；fieldSize 1。
- `water_fountain` 净水站 ⛲：fields `water`, `land`；price 76；fieldSize 1.35。
- `water_boat` 渡船站 ⛴️：fields `water`；price 64；fieldSize 1.2。
- `water_bridge` 小桥 🌉：fields `water`, `land`；price 76；fieldSize 1.4。

### Sky 天空

- `sky_cloud` 云中小屋 🏠：type `house`；fields `sky`；rooms `bedroom`；price 96；uniqueItem；fieldSize 1.2。
- `sky_kite` 信号塔 🗼：fields `sky`；price 54；fieldSize 1.25。
- `sky_balloon` 飞艇港 🚡：fields `sky`；price 64；fieldSize 1.35。
- `sky_windmill` 风车站 🌬️：fields `sky`, `land`；price 54；fieldSize 1.3。

### 特殊生态与远程物品

- `fire_volcano` 火山 🌋：fields `fire`；price 0；remoteOnly；zorder -1；fieldSize 2.4。
- `ice_lake` 冰湖 🧊：fields `ice`；price 0；remoteOnly；zorder -1；fieldSize 2。
- `life_sand_tree` 沙池生命树 🏝️：fields `life`；price 0；remoteOnly；zorder -1；fieldSize 2.2。
- `dark_underground_caves` 地下洞穴 🕳️：fields `dark`；price 0；remoteOnly；zorder -1；fieldSize 2。

## 房屋 House

### Outdoor 基础房屋升级线

- `house_1` 一间小屋 🏠：fields `outdoor`；rooms `bedroom`；price 0；hiddenFromShop；uniqueItem；fieldSize 0.8。
- `house_2` 双间小屋 🏠：fields `outdoor`；rooms `bedroom`, `kitchen`；price 140；uniqueItem；fieldSize 0.9。
- `house_3` 三间居所 🏡：fields `outdoor`；rooms `bedroom`, `kitchen`, `bath`；price 280；uniqueItem；fieldSize 1。
- `house_4` 四间宅院 🏡：fields `outdoor`；rooms `bedroom`, `kitchen`, `bath`, `living`；price 480；uniqueItem；fieldSize 1.1。
- `house_5` 五间豪宅 🏛️：fields `outdoor`；rooms `bedroom`, `kitchen`, `bath`, `living`, `garden`；price 720；uniqueItem；fieldSize 1.2。

### 生态房屋

- `land_tent` 帐篷 ⛺：陆地生态卧室房屋，已在 Land 分类列出。
- `sky_cloud` 云中小屋 🏠：天空生态卧室房屋，已在 Sky 分类列出。

## 已覆盖概念索引

### 功能概念

- 饱腹食物、情绪零食、trait 食物、阶段药丸。
- 基础玩具：球、鼓。
- 室内基础家具：床、沙发、灯、植物、电视、桌椅、画、钟、浴缸、冰箱、柜类、窗门、厨卫设备、电脑、钢琴、空调、风扇、垃圾桶、玩具箱等。
- 房间专属基础物：卧室寝具、厨房料理用品、浴室清洁用品、客厅娱乐用品、花园休闲装饰。
- 户外站点：服务站、医护站、路标站、学校、商店、水上医院、码头、净水站、渡船站、桥、信号塔、飞艇港、风车站。
- 特殊地貌：火山、冰湖、沙池生命树、地下洞穴。
- 基础房屋升级：一间到五间，以及陆地帐篷、天空小屋。

### 适合后续新增的方向

- 生态互动设施：可采集、可触发任务、可改变天气或生态状态的物品。
- 主题套装：节日、职业、星际、古风、海底、云端、火山、冰原、洞穴等，但需避开已有基础家具。
- 特殊玩法物品：生产资源、开启小游戏、加速恢复、改变宠物行为、解锁故事事件。
- 装饰变体应有强主题差异，不要只做颜色或尺寸变化。
