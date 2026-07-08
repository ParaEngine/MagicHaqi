"""
AI回复总结评论 - Web 界面
使用 Streamlit 构建，支持多平台评论分析
"""

import os
import sys
import time
from datetime import datetime

import streamlit as st
from dotenv import load_dotenv

from database import Database
from platforms import CollectorFactory
from ai_analyzer import AIAnalyzer
from report_generator import ReportGenerator
from config_manager import save_config, set_platform_config, load_config
from reply_manager import ReplyManager, BILIBILI_REPLY_INTERVAL


# 平台配置映射
PLATFORM_CONFIG = {
    "twitter": {
        "display_name": "Twitter / X",
        "icon": "🐦",
        "color": "#1DA1F2",
        "config_fields": [
            {"key": "bearer_token", "label": "Bearer Token", "type": "password", "env": "TWITTER_BEARER_TOKEN"},
        ],
        "post_label": "推文 ID 或链接",
        "post_placeholder": "例如: https://twitter.com/user/status/123456789",
    },
    "bilibili": {
        "display_name": "哔哩哔哩 (B站)",
        "icon": "📺",
        "color": "#FB7299",
        "config_fields": [
            {"key": "sessdata", "label": "SESSDATA Cookie", "type": "password", "env": "BILIBILI_SESSDATA"},
            {"key": "bili_jct", "label": "bili_jct (CSRF Token)", "type": "password", "env": "BILIBILI_BILI_JCT"},
        ],
        "post_label": "视频链接或 BV 号",
        "post_placeholder": "例如: BV1xx411c7mD 或 https://www.bilibili.com/video/BV1xx411c7mD",
    },
    "xiaohongshu": {
        "display_name": "小红书",
        "icon": "📕",
        "color": "#FE2C55",
        "config_fields": [
            {"key": "cookie", "label": "登录 Cookie", "type": "text", "env": "XHS_COOKIE"},
        ],
        "post_label": "笔记链接或 ID",
        "post_placeholder": "例如: https://www.xiaohongshu.com/explore/65abc123",
    },
    "weibo": {
        "display_name": "微博",
        "icon": "🌐",
        "color": "#E6162D",
        "config_fields": [
            {"key": "cookie", "label": "登录 Cookie (可选)", "type": "text", "env": "WEIBO_COOKIE"},
        ],
        "post_label": "微博链接或 ID",
        "post_placeholder": "例如: https://m.weibo.cn/status/123456789",
    },
    "douyin": {
        "display_name": "抖音",
        "icon": "🎵",
        "color": "#000000",
        "config_fields": [
            {"key": "cookie", "label": "登录 Cookie", "type": "text", "env": "DOUYIN_COOKIE"},
        ],
        "post_label": "视频链接或 ID",
        "post_placeholder": "例如: https://www.douyin.com/video/7123456789",
    },
    "taptap": {
        "display_name": "TapTap (游戏社区)",
        "icon": "🎮",
        "color": "#15B5DD",
        "config_fields": [
            {"key": "cookie", "label": "登录 Cookie (可选)", "type": "text", "env": "TAPTAP_COOKIE"},
        ],
        "post_label": "游戏链接或 App ID",
        "post_placeholder": "例如: https://www.taptap.cn/app/123456 或直接输入 App ID",
    },
}


def get_db():
    """获取数据库实例"""
    if "db" not in st.session_state:
        db_path = st.session_state.get("db_path", "socialecho.db")
        st.session_state.db = Database(db_path)
    return st.session_state.db


def get_collector(platform: str):
    """获取平台收集器实例"""
    cache_key = f"collector_{platform}"
    if cache_key not in st.session_state:
        config = {}
        platform_info = PLATFORM_CONFIG.get(platform, {})
        for field in platform_info.get("config_fields", []):
            key = field["key"]
            env_key = field["env"]
            value = st.session_state.get(f"{platform}_{key}", "")
            if not value:
                value = os.getenv(env_key, "")
            config[key] = value

        collector = CollectorFactory.create(platform, **config)
        st.session_state[cache_key] = collector
    return st.session_state[cache_key]


def get_ai_analyzer():
    """获取 AI 分析器实例"""
    if "ai_analyzer" not in st.session_state:
        api_key = st.session_state.get("openai_api_key", "") or os.getenv("OPENAI_API_KEY", "")
        base_url = st.session_state.get("openai_base_url", "") or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        model = st.session_state.get("openai_model", "") or os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")
        if api_key:
            st.session_state.ai_analyzer = AIAnalyzer(
                api_key=api_key,
                base_url=base_url,
                model=model
            )
    return st.session_state.get("ai_analyzer")


def get_report_gen():
    """获取报告生成器实例"""
    if "report_gen" not in st.session_state:
        report_dir = st.session_state.get("report_dir", "reports")
        st.session_state.report_gen = ReportGenerator(report_dir)
    return st.session_state.report_gen


def init_config():
    """初始化配置"""
    load_dotenv()

    # 从 .env 文件加载配置
    saved_config = load_config()

    defaults = {
        "db_path": saved_config.get("DB_PATH", "socialecho.db"),
        "report_dir": saved_config.get("REPORT_DIR", "reports"),
        "openai_api_key": saved_config.get("OPENAI_API_KEY", ""),
        "openai_base_url": saved_config.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "openai_model": saved_config.get("OPENAI_MODEL", "gpt-3.5-turbo"),
        "selected_platform": saved_config.get("DEFAULT_PLATFORM", "bilibili"),
        "current_post_id": "",
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    # 加载平台配置到 session_state
    platform_keys = {
        "twitter": "TWITTER_BEARER_TOKEN",
        "bilibili_sessdata": "BILIBILI_SESSDATA",
        "bilibili_bili_jct": "BILIBILI_BILI_JCT",
        "xiaohongshu_cookie": "XHS_COOKIE",
        "weibo_cookie": "WEIBO_COOKIE",
        "douyin_cookie": "DOUYIN_COOKIE",
    }

    for key, env_key in platform_keys.items():
        if key not in st.session_state:
            st.session_state[key] = saved_config.get(env_key, "")


def page_config():
    """页面配置"""
    st.set_page_config(
        page_title="AI回复总结评论",
        page_icon="📊",
        layout="wide",
        initial_sidebar_state="expanded"
    )

    st.markdown("""
        <style>
        .stProgress > div > div > div > div {
            background-image: linear-gradient(to right, #667eea, #764ba2);
        }
        div[data-testid="stMetric"] {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 10px;
            border: 1px solid #e9ecef;
        }
        </style>
    """, unsafe_allow_html=True)


def test_platform_connection(platform: str, config: dict) -> tuple[bool, str]:
    """测试平台连接是否正常"""
    from platforms import CollectorFactory

    collector = CollectorFactory.create(platform, **config)
    if not collector:
        return False, "无法创建收集器"

    # 测试获取帖子信息（使用公开测试 ID）
    test_ids = {
        "twitter": "20",  # @jack 的第一条推文
        "bilibili": "BV1xx411c7mD",
        "xiaohongshu": "65abc123",  # 占位
        "weibo": "5878493111",  # 占位
        "douyin": "7123456789",  # 占位
    }

    test_id = test_ids.get(platform, "")
    try:
        if platform == "bilibili":
            info = collector.get_post_info(test_id)
            if info:
                return True, f"连接成功！获取到视频: {info.get('title', '')[:30]}..."
        elif platform == "twitter":
            info = collector.get_post_info(test_id)
            if info:
                return True, f"连接成功！获取到推文: {info.get('content', '')[:30]}..."
        elif platform == "weibo":
            info = collector.get_post_info(test_id)
            if info:
                return True, f"连接成功！获取到微博"
        else:
            # 小红书和抖音需要真实 cookie
            return True, "配置已保存，请在「拉取评论」页面测试"
        return True, "连接成功！"
    except Exception as e:
        return False, f"连接失败: {str(e)[:100]}"


def test_api_connection(api_key: str, base_url: str, model: str) -> tuple[bool, str]:
    """测试 AI API 连接是否正常"""
    from openai import OpenAI

    try:
        client = OpenAI(
            api_key=api_key,
            base_url=base_url if base_url else "https://api.openai.com/v1"
        )

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Hi"}],
            max_tokens=10
        )

        if response.choices:
            return True, f"API 连接成功！模型: {model}"
        return False, "API 返回异常"
    except Exception as e:
        return False, f"API 连接失败: {str(e)[:100]}"


def sidebar():
    """侧边栏"""
    with st.sidebar:
        st.title("📊 AI回复总结评论")
        st.caption("多平台智能评论分析与回复助手")
        st.markdown("---")

        # 平台选择
        st.subheader("🎯 选择平台")
        platforms = list(PLATFORM_CONFIG.keys())
        display_names = [f"{PLATFORM_CONFIG[p]['icon']} {PLATFORM_CONFIG[p]['display_name']}" for p in platforms]
        selected_idx = platforms.index(st.session_state.selected_platform) if st.session_state.selected_platform in platforms else 0

        selected_display = st.selectbox(
            "平台",
            options=display_names,
            index=selected_idx,
            label_visibility="collapsed"
        )

        # 更新选中的平台
        for i, name in enumerate(display_names):
            if name == selected_display:
                st.session_state.selected_platform = platforms[i]
                break

        platform = st.session_state.selected_platform
        platform_info = PLATFORM_CONFIG[platform]

        st.markdown("---")
        st.subheader(f"⚙️ {platform_info['icon']} {platform_info['display_name']} 配置")

        # 平台配置字段
        platform_config = {}
        for field in platform_info.get("config_fields", []):
            key = field["key"]
            # 使用简化的 session_key 格式
            session_key = f"{platform}_{key}"

            # 如果 session 中没有值，尝试加载
            if session_key not in st.session_state or not st.session_state.get(session_key):
                saved = load_config().get(field["env"], "")
                if saved:
                    st.session_state[session_key] = saved

            if field["type"] == "password":
                st.text_input(
                    field["label"],
                    value=st.session_state.get(session_key, ""),
                    type="password",
                    key=session_key,
                    label_visibility="visible"
                )
            else:
                st.text_area(
                    field["label"],
                    value=st.session_state.get(session_key, ""),
                    height=80,
                    key=session_key,
                    label_visibility="visible"
                )

            platform_config[key] = st.session_state.get(session_key, "")

        # 保存并测试平台配置按钮
        col1, col2 = st.columns(2)
        with col1:
            save_platform = st.button("💾 保存到本地", key="save_platform_btn", use_container_width=True)
        with col2:
            test_platform = st.button("🔗 测试连接", key="test_platform_btn", use_container_width=True)

        if save_platform:
            # 保存平台配置到 .env 文件
            env_prefix = {
                "twitter": "TWITTER_BEARER_TOKEN",
                "bilibili": "BILIBILI",
                "xiaohongshu": "XHS_COOKIE",
                "weibo": "WEIBO_COOKIE",
                "douyin": "DOUYIN_COOKIE",
            }

            updates = {}
            for key, value in platform_config.items():
                if key == "bearer_token":
                    updates["TWITTER_BEARER_TOKEN"] = value
                elif key == "sessdata":
                    updates["BILIBILI_SESSDATA"] = value
                elif key == "bili_jct":
                    updates["BILIBILI_BILI_JCT"] = value
                else:
                    prefix = env_prefix.get(platform, "").split("_")[0]
                    updates[f"{prefix}_{key.upper()}"] = value

            if save_config(updates):
                st.success("✅ 平台配置已保存到本地 .env 文件！")
            else:
                st.error("❌ 保存失败，请检查权限")

        if test_platform:
            with st.spinner("正在测试连接..."):
                ok, msg = test_platform_connection(platform, platform_config)
                if ok:
                    st.success(msg)
                else:
                    st.error(msg)

        st.markdown("---")
        st.subheader("🤖 AI 配置")

        # 尝试加载已保存的 AI 配置
        saved_config = load_config()
        default_api_key = saved_config.get("OPENAI_API_KEY", "")
        default_base_url = saved_config.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
        default_model = saved_config.get("OPENAI_MODEL", "gpt-3.5-turbo")

        # 如果 session 中没有值，使用已保存的值
        if not st.session_state.get("openai_api_key") and default_api_key:
            st.session_state.openai_api_key = default_api_key
        if not st.session_state.get("openai_base_url") and default_base_url:
            st.session_state.openai_base_url = default_base_url
        if not st.session_state.get("openai_model") and default_model:
            st.session_state.openai_model = default_model

        st.text_input(
            "OpenAI API Key",
            type="password",
            key="openai_api_key",
            help="支持任何 OpenAI 兼容的 API"
        )

        st.text_input(
            "API Base URL",
            key="openai_base_url",
            help="默认: https://api.openai.com/v1"
        )

        st.selectbox(
            "模型",
            options=["gpt-3.5-turbo", "gpt-4", "gpt-4o", "gpt-4o-mini", "deepseek-v3-pro", "deepseek-chat", "qwen-plus", "qwen-turbo"],
            key="openai_model"
        )

        # 保存并测试 AI 配置按钮
        col1, col2 = st.columns(2)
        with col1:
            save_api = st.button("💾 保存到本地", key="save_api_btn", use_container_width=True)
        with col2:
            test_api = st.button("🔗 测试连接", key="test_api_btn", use_container_width=True)

        if save_api:
            # 保存 AI 配置到 .env 文件
            updates = {
                "OPENAI_API_KEY": st.session_state.get("openai_api_key", ""),
                "OPENAI_BASE_URL": st.session_state.get("openai_base_url", "https://api.openai.com/v1"),
                "OPENAI_MODEL": st.session_state.get("openai_model", "gpt-3.5-turbo"),
            }
            if save_config(updates):
                st.success("✅ AI 配置已保存到本地 .env 文件！")
            else:
                st.error("❌ 保存失败，请检查权限")

        if test_api:
            api_key = st.session_state.get("openai_api_key", "")
            base_url = st.session_state.get("openai_base_url", "") or "https://api.openai.com/v1"
            model = st.session_state.get("openai_model", "gpt-3.5-turbo")

            if not api_key:
                st.error("请先输入 API Key")
            else:
                with st.spinner("正在测试 AI API..."):
                    ok, msg = test_api_connection(api_key, base_url, model)
                    if ok:
                        st.success(msg)
                    else:
                        st.error(msg)

        st.markdown("---")
        st.caption("💡 配置保存后，下次启动会自动加载")


def page_home():
    """首页 - 总览"""
    st.title("📊 总览")
    st.markdown("---")

    db = get_db()
    platform = st.session_state.selected_platform
    post_id = st.session_state.get("current_post_id", "")

    # 获取所有平台的统计
    platforms = db.get_platforms()

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("📝 总评论数", db.get_total_count())
    with col2:
        st.metric("🌐 平台数量", len(platforms) if platforms else 0)
    with col3:
        st.metric("📋 帖子数量", len(db.get_posts()))

    st.markdown("---")

    if post_id:
        st.subheader(f"当前帖子分析")
        total = db.get_total_count(post_id, platform)
        sentiment_stats = db.get_sentiment_stats(post_id, platform)
        intent_stats = db.get_intent_stats(post_id, platform)
        unanalyzed = db.get_unanalyzed_comments(post_id, platform)

        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("📝 评论总数", total)
        with col2:
            st.metric("✅ 已分析", total - len(unanalyzed))
        with col3:
            st.metric("⏳ 待分析", len(unanalyzed))
        with col4:
            st.metric("🌐 平台", PLATFORM_CONFIG.get(platform, {}).get('display_name', platform))

        st.markdown("---")

        col1, col2 = st.columns(2)

        with col1:
            st.subheader("💭 情感分布")
            if sentiment_stats:
                total_sent = sum(sentiment_stats.values())
                for s, count in sorted(sentiment_stats.items(), key=lambda x: x[1], reverse=True):
                    pct = (count / total_sent * 100) if total_sent > 0 else 0
                    emoji = {"POSITIVE": "😊 正面", "NEUTRAL": "😐 中性", "NEGATIVE": "😠 负面"}.get(s, s)
                    st.write(f"**{emoji}**: {count} ({pct:.1f}%)")
                    st.progress(pct / 100)
            else:
                st.info("暂无情感分析数据")

        with col2:
            st.subheader("🎯 意图分布")
            if intent_stats:
                total_int = sum(intent_stats.values())
                for i, count in sorted(intent_stats.items(), key=lambda x: x[1], reverse=True):
                    pct = (count / total_int * 100) if total_int > 0 else 0
                    emoji = {"INQUIRY": "❓ 咨询", "FEEDBACK": "💬 反馈", "COMPLAINT": "⚠️ 投诉", "SPAM": "🚫 垃圾", "OTHER": "📝 其他"}.get(i, i)
                    st.write(f"**{emoji}**: {count} ({pct:.1f}%)")
                    st.progress(pct / 100)
            else:
                st.info("暂无意图分析数据")
    else:
        st.info("👈 请先在「拉取评论」页面输入帖子链接开始分析")


def page_fetch():
    """拉取评论页面"""
    platform = st.session_state.selected_platform
    platform_info = PLATFORM_CONFIG[platform]

    st.title(f"{platform_info['icon']} 拉取 {platform_info['display_name']} 评论")
    st.markdown("---")

    # 获取该平台已保存的帖子列表
    db = get_db()
    saved_posts = db.get_posts(platform)

    if saved_posts:
        st.info(f"📋 已拉取过 {len(saved_posts)} 个帖子的评论")
        post_options = ["🔄 输入新帖子"] + [f"{p.get('title', p.get('id', ''))[:40]}... ({p.get('id', '')[:15]})" for p in saved_posts]
        selected_post = st.selectbox("选择已拉取的帖子", options=range(len(post_options)), format_func=lambda x: post_options[x])

        if selected_post > 0:
            selected = saved_posts[selected_post - 1]
            st.session_state.current_post_id = selected.get("id", "")
            st.session_state.current_post_title = selected.get("title", "")
            st.success(f"已选择帖子: {selected.get('title', selected.get('id', ''))[:50]}")
            st.markdown("---")

    post_input = st.text_input(
        platform_info["post_label"],
        value=st.session_state.get("current_post_id", ""),
        placeholder=platform_info["post_placeholder"],
        key="post_input_field"
    )

    col1, col2 = st.columns([1, 1])
    with col1:
        max_comments = st.slider("最大拉取数量", min_value=10, max_value=500, value=100, step=10)
    with col2:
        st.write("")
        st.write("")
        fetch_btn = st.button("🚀 开始拉取", type="primary", use_container_width=True)

    if fetch_btn:
        if not post_input:
            st.error("请输入帖子链接或 ID")
            return

        collector = get_collector(platform)
        if not collector:
            st.error(f"无法初始化 {platform_info['display_name']} 收集器")
            return

        with st.spinner("正在获取帖子信息..."):
            post_info = collector.get_post_info(post_input)
            if post_info:
                st.success("✅ 找到帖子")

                # 保存标准化的 post_id
                normalized_post_id = post_info.get("id", post_input)
                st.session_state.current_post_id = normalized_post_id
                st.session_state.current_post_title = post_info.get("title", "")

                with st.expander("查看帖子详情", expanded=True):
                    if post_info.get("title"):
                        st.subheader(post_info["title"])
                    if post_info.get("content"):
                        st.info(post_info["content"][:500] + "..." if len(post_info.get("content", "")) > 500 else post_info["content"])
                    col1, col2, col3, col4 = st.columns(4)
                    with col1:
                        st.metric("❤️ 点赞", f"{post_info.get('like_count', 0):,}")
                    with col2:
                        st.metric("💬 评论", f"{post_info.get('comment_count', 0):,}")
                    with col3:
                        st.metric("🔁 分享", f"{post_info.get('share_count', 0):,}")
                    with col4:
                        st.metric("👀 浏览", f"{post_info.get('view_count', 0):,}")
                    if post_info.get("author_name"):
                        st.caption(f"作者: {post_info['author_name']}")
                    if post_info.get("url"):
                        st.markdown(f"[🔗 打开原帖]({post_info['url']})")

                # 保存帖子信息到数据库
                db.insert_post(post_info)
            else:
                st.warning("⚠️ 无法获取帖子信息，但继续尝试拉取评论")
                st.session_state.current_post_id = post_input

        with st.spinner(f"正在拉取评论（最多 {max_comments} 条）..."):
            comments = collector.fetch_comments(post_input, max_comments=max_comments)

            if comments:
                # 确保评论的 post_id 与保存的一致
                normalized_id = st.session_state.current_post_id
                for comment in comments:
                    comment["post_id"] = normalized_id
                    comment["platform"] = platform

                stored = db.insert_comments_batch(comments)
                st.success(f"✅ 成功获取并存储 {stored} 条评论")

                # 显示评论预览
                st.subheader("📋 评论预览（前 5 条）")
                for i, comment in enumerate(comments[:5]):
                    with st.container(border=True):
                        col1, col2 = st.columns([1, 5])
                        with col1:
                            if comment.get("author_avatar"):
                                st.image(comment["author_avatar"], width=40)
                            st.write(f"**{comment.get('author_name', '未知')}**")
                            st.caption(comment.get('created_at', '')[:19] if comment.get('created_at') else '')
                        with col2:
                            st.write(comment.get('text', ''))
                        col1, col2, col3 = st.columns(3)
                        with col1:
                            st.write(f"❤️ {comment.get('like_count', 0)}")
                        with col2:
                            st.write(f"💬 {comment.get('reply_count', 0)}")
                        with col3:
                            if comment.get('ip_location'):
                                st.caption(f"📍 {comment['ip_location']}")
            else:
                st.warning("⚠️ 未获取到任何评论，请检查链接或 Cookie 是否正确")


def page_analyze():
    """AI 分析页面"""
    st.title("🤖 AI 分析评论")
    st.markdown("---")

    db = get_db()
    platform = st.session_state.selected_platform
    platform_info = PLATFORM_CONFIG.get(platform, {})
    post_id = st.session_state.get("current_post_id", "")

    # 获取该平台所有帖子列表
    all_posts = db.get_posts(platform)

    if not all_posts:
        st.info("👈 请先在「拉取评论」页面拉取评论")
        return

    # 显示当前帖子信息
    if post_id:
        current_post = db.get_post(post_id, platform)
        if current_post:
            col1, col2 = st.columns([3, 1])
            with col1:
                st.success(f"📺 当前帖子: {current_post.get('title', post_id)[:60]}")
            with col2:
                if st.button("🔄 切换帖子", use_container_width=True):
                    st.session_state.current_post_id = ""
                    st.rerun()
    else:
        st.info("请选择一个帖子进行分析：")
        post_options = [p.get('title', p.get('id', ''))[:50] or p.get('id', '') for p in all_posts]
        selected_idx = st.selectbox("选择帖子", options=range(len(post_options)), format_func=lambda x: post_options[x])
        if selected_idx is not None:
            st.session_state.current_post_id = all_posts[selected_idx].get("id", "")
            st.rerun()
        return

    unanalyzed = db.get_unanalyzed_comments(post_id, platform)
    total = db.get_total_count(post_id, platform)
    analyzed = total - len(unanalyzed)

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("📝 总评论数", total)
    with col2:
        st.metric("⏳ 待分析", len(unanalyzed))
    with col3:
        st.metric("✅ 已分析", analyzed)

    st.markdown("---")

    if len(unanalyzed) == 0:
        st.success("🎉 所有评论均已分析完成！")
        st.info("💡 可以前往「生成报告」页面查看分析结果")
    else:
        st.write(f"当前有 **{len(unanalyzed)}** 条评论等待分析")

        if st.button("🤖 开始 AI 分析", type="primary", use_container_width=True):
            api_key = st.session_state.get("openai_api_key", "")
            if not api_key:
                st.error("请先在侧边栏配置 OpenAI API Key")
                return

            ai = get_ai_analyzer()
            if not ai:
                st.error("AI 分析器初始化失败，请检查 API 配置")
                return

            progress_bar = st.progress(0)
            status_text = st.empty()

            analyses = []
            total_count = len(unanalyzed)

            for i, comment in enumerate(unanalyzed):
                progress = (i + 1) / total_count
                progress_bar.progress(progress)
                status_text.text(f"正在分析: {i + 1}/{total_count}")

                result = ai.analyze_comment(comment.get("text", ""))
                if result:
                    analysis = {
                        "comment_id": comment["id"],
                        "platform": comment.get("platform", platform),
                        "sentiment": result["sentiment"],
                        "intent": result["intent"],
                        "summary": result["summary"],
                        "model": st.session_state.openai_model
                    }
                    analyses.append(analysis)

            stored = db.insert_analyses_batch(analyses)
            progress_bar.progress(1.0)
            status_text.text("分析完成！")

            st.success(f"✅ 成功分析 {stored} 条评论")
            st.rerun()


def page_negative():
    """负面评论页面"""
    st.title("⚠️ 负面评论 / 投诉")
    st.markdown("---")

    db = get_db()
    platform = st.session_state.selected_platform
    post_id = st.session_state.get("current_post_id", "")

    # 获取该平台所有帖子列表
    all_posts = db.get_posts(platform)

    if not all_posts:
        st.info("👈 请先在「拉取评论」页面拉取评论")
        return

    # 显示当前帖子信息
    if post_id:
        current_post = db.get_post(post_id, platform)
        if current_post:
            col1, col2 = st.columns([3, 1])
            with col1:
                st.success(f"📺 当前帖子: {current_post.get('title', post_id)[:60]}")
            with col2:
                if st.button("🔄 切换帖子", key="neg_switch", use_container_width=True):
                    st.session_state.current_post_id = ""
                    st.rerun()
    else:
        st.info("请选择一个帖子查看：")
        post_options = [p.get('title', p.get('id', ''))[:50] or p.get('id', '') for p in all_posts]
        selected_idx = st.selectbox("选择帖子", options=range(len(post_options)), format_func=lambda x: post_options[x], key="neg_select")
        if selected_idx is not None:
            st.session_state.current_post_id = all_posts[selected_idx].get("id", "")
            st.rerun()
        return

    negative_comments = db.get_top_negative_comments(post_id, platform, limit=20)

    if not negative_comments:
        st.success("🎉 暂无负面评论或投诉！")
        return

    st.write(f"共找到 **{len(negative_comments)}** 条负面评论/投诉")
    st.markdown("---")

    for i, comment in enumerate(negative_comments, 1):
        with st.container(border=True):
            col1, col2 = st.columns([1, 5])
            with col1:
                st.write(f"### #{i}")
                if comment.get("author_avatar"):
                    st.image(comment["author_avatar"], width=40)
                st.write(f"**{comment.get('author_name', '未知')}**")
                st.caption(comment.get('created_at', '')[:19] if comment.get('created_at') else '')
            with col2:
                st.write(comment.get('text', ''))
                st.caption(f"💡 {comment.get('summary', '')}")

            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.write(f"❤️ {comment.get('like_count', 0)}")
            with col2:
                sentiment = comment.get('sentiment', '')
                badge = "🔴 负面" if sentiment == "NEGATIVE" else ("🟡 中性" if sentiment == "NEUTRAL" else "🟢 正面")
                st.write(badge)
            with col3:
                st.write(f"🎯 {comment.get('intent', '')}")
            with col4:
                st.write(f"💬 {comment.get('reply_count', 0)}")


def page_report():
    """生成报告页面"""
    st.title("📄 生成分析报告")
    st.markdown("---")

    db = get_db()
    platform = st.session_state.selected_platform
    post_id = st.session_state.get("current_post_id", "")

    # 获取该平台所有帖子列表
    all_posts = db.get_posts(platform)

    if not all_posts:
        st.info("👈 请先在「拉取评论」页面拉取评论")
        return

    # 显示当前帖子信息
    if post_id:
        current_post = db.get_post(post_id, platform)
        if current_post:
            col1, col2 = st.columns([3, 1])
            with col1:
                st.success(f"📺 当前帖子: {current_post.get('title', post_id)[:60]}")
            with col2:
                if st.button("🔄 切换帖子", key="rep_switch", use_container_width=True):
                    st.session_state.current_post_id = ""
                    st.rerun()
    else:
        st.info("请选择一个帖子生成报告：")
        post_options = [p.get('title', p.get('id', ''))[:50] or p.get('id', '') for p in all_posts]
        selected_idx = st.selectbox("选择帖子", options=range(len(post_options)), format_func=lambda x: post_options[x], key="rep_select")
        if selected_idx is not None:
            st.session_state.current_post_id = all_posts[selected_idx].get("id", "")
            st.rerun()
        return

    total = db.get_total_count(post_id, platform)

    if total == 0:
        st.warning("⚠️ 暂无评论数据，请先拉取评论")
        return

    sentiment_stats = db.get_sentiment_stats(post_id, platform)
    analyzed = sum(sentiment_stats.values()) if sentiment_stats else 0

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("📝 评论总数", total)
    with col2:
        st.metric("✅ 已分析", analyzed)
    with col3:
        st.metric("📊 分析率", f"{analyzed/total*100:.1f}%" if total > 0 else "0%")

    # 检查是否已完成 AI 分析
    if analyzed == 0:
        st.warning("⚠️ 当前帖子尚未进行 AI 分析！")
        st.info("💡 请先前往「🤖 AI 分析」页面，点击「开始 AI 分析」按钮")
        st.markdown("---")

        # 显示未分析的评论预览
        st.subheader("📋 评论预览（未分析）")
        preview_comments = db.get_comments_by_post(post_id, platform, limit=10)
        for i, comment in enumerate(preview_comments, 1):
            with st.container(border=True):
                col1, col2 = st.columns([1, 5])
                with col1:
                    st.write(f"#{i}")
                    if comment.get("author_avatar"):
                        st.image(comment["author_avatar"], width=40)
                    st.write(f"**{comment.get('author_name', '未知')}**")
                with col2:
                    st.write(comment.get('text', '')[:200])
                st.caption(f"❤️ {comment.get('like_count', 0)}  |  📍 {comment.get('ip_location', 'N/A')}")
        return

    st.markdown("---")

    # 深度分析选项
    use_deep_analysis = st.toggle(
        "🤖 启用 AI 深度分析（生成痛点、Bug、建议、优先级排序）",
        value=True,
        help="使用 AI 对评论进行深度分析，提取痛点、Bug、改进建议和问题优先级排序（可能需要额外时间）"
    )

    if st.button("📄 生成分析报告", type="primary", use_container_width=True):
        report_gen = get_report_gen()

        # 获取帖子信息
        post_info = db.get_post(post_id, platform)

        # 获取 AI 分析器（如果启用深度分析）
        ai_analyzer = None
        if use_deep_analysis:
            ai_key = st.session_state.get("openai_api_key", "")
            if ai_key:
                ai_analyzer = get_ai_analyzer()
            else:
                st.warning("⚠️ 未配置 OpenAI API Key，深度分析功能不可用")
                st.info("💡 请在侧边栏配置 API Key，或关闭深度分析选项")

        with st.spinner("正在生成报告..." + ("（含深度分析，可能需要一点时间）" if use_deep_analysis else "")):
            import inspect
            sig = inspect.signature(report_gen.generate_report)
            kwargs = {
                "db": db,
                "post_id": post_id,
                "platform": platform,
                "post_info": post_info,
            }
            if "ai_analyzer" in sig.parameters:
                kwargs["ai_analyzer"] = ai_analyzer
            report_path = report_gen.generate_report(**kwargs)

        st.success(f"✅ 报告已生成: `{report_path}`")

        # 读取并显示报告
        with open(report_path, 'r', encoding='utf-8') as f:
            report_content = f.read()

        st.markdown("---")
        st.subheader("📄 报告预览")
        with st.container(height=500):
            st.markdown(report_content)

        # 下载按钮
        st.download_button(
            label="⬇️ 下载报告",
            data=report_content,
            file_name=os.path.basename(report_path),
            mime="text/markdown",
            use_container_width=True
        )


def auto_detect_platform(url: str) -> str:
    """自动检测 URL 所属平台"""
    url_lower = url.lower()
    if "twitter.com" in url_lower or "x.com" in url_lower:
        return "twitter"
    elif "bilibili.com" in url_lower or "bv" in url_lower.lower():
        return "bilibili"
    elif "xiaohongshu.com" in url_lower or "xhs" in url_lower:
        return "xiaohongshu"
    elif "weibo.com" in url_lower:
        return "weibo"
    elif "douyin.com" in url_lower:
        return "douyin"
    elif "taptap" in url_lower:
        return "taptap"
    return "bilibili"  # 默认


def page_one_click():
    """一键分析页面"""
    st.title("🚀 一键智能分析")
    st.markdown("只需粘贴网址，自动完成：解析 → 拉取 → 分析 → 报告")
    st.markdown("---")

    # URL 输入
    url_input = st.text_input(
        "🔗 粘贴帖子/视频链接",
        placeholder="支持: Twitter、B站、小红书、微博、抖音、TapTap链接",
        help="粘贴任意平台的帖子/视频链接，系统会自动识别平台并分析"
    )

    col1, col2 = st.columns([1, 1])
    with col1:
        max_comments = st.slider("评论数量", min_value=10, max_value=500, value=100, step=10)
    with col2:
        analyze_immediately = st.checkbox("自动开始 AI 分析", value=True)

    if st.button("🚀 开始一键分析", type="primary", use_container_width=True):
        if not url_input:
            st.error("请先粘贴网址！")
            return

        # 自动检测平台
        platform = auto_detect_platform(url_input)
        platform_info = PLATFORM_CONFIG.get(platform, {})
        st.info(f"🔍 检测到平台: {platform_info.get('display_name', platform)}")

        # 更新 session
        st.session_state.selected_platform = platform

        # 进度显示
        progress_bar = st.progress(0)
        status_text = st.empty()

        # 步骤 1: 获取收集器
        progress_bar.progress(0.1)
        status_text.text("📡 初始化收集器...")

        collector = get_collector(platform)
        if not collector:
            st.error(f"❌ 无法初始化 {platform_info.get('display_name', platform)} 收集器，请先配置 Cookie")
            return

        # 步骤 2: 获取帖子信息
        progress_bar.progress(0.2)
        status_text.text("📺 获取帖子信息...")

        with st.spinner("获取帖子信息..."):
            post_info = collector.get_post_info(url_input)

        if not post_info:
            st.error("❌ 无法获取帖子信息，请检查链接是否正确")
            return

        normalized_post_id = post_info.get("id", url_input)
        st.session_state.current_post_id = normalized_post_id

        # 保存帖子信息
        db = get_db()
        db.insert_post(post_info)

        progress_bar.progress(0.3)
        status_text.text("✅ 获取帖子信息成功")

        # 显示帖子信息
        with st.expander("📺 帖子详情", expanded=True):
            col1, col2 = st.columns([3, 1])
            with col1:
                content = post_info.get('content', '')
                if isinstance(content, str):
                    content = content[:50]
                else:
                    content = str(content)[:50]
                st.write(f"**{post_info.get('title', content)}**")
            with col2:
                st.metric("💬 评论数", f"{post_info.get('comment_count', 0):,}")

        # 步骤 3: 拉取评论
        progress_bar.progress(0.4)
        status_text.text(f"📥 正在拉取评论（最多 {max_comments} 条）...")

        with st.spinner("拉取评论中..."):
            comments = collector.fetch_comments(url_input, max_comments=max_comments)

        if not comments:
            st.warning("⚠️ 未获取到评论")
            return

        # 确保评论数据正确
        for comment in comments:
            comment["post_id"] = normalized_post_id
            comment["platform"] = platform

        stored = db.insert_comments_batch(comments)
        progress_bar.progress(0.6)
        status_text.text(f"✅ 获取 {stored} 条评论")

        st.success(f"📥 成功获取 {stored} 条评论")

        # 步骤 4: AI 分析
        if analyze_immediately:
            api_key = st.session_state.get("openai_api_key", "")
            if not api_key:
                st.warning("⚠️ 未配置 AI API Key，跳过分析步骤")
            else:
                progress_bar.progress(0.7)
                status_text.text("🤖 正在进行 AI 分析...")

                ai = get_ai_analyzer()
                if not ai:
                    st.warning("⚠️ AI 分析器初始化失败")
                else:
                    unanalyzed = db.get_unanalyzed_comments(normalized_post_id, platform)
                    total_count = len(unanalyzed)
                    analyses = []

                    analysis_progress = st.progress(0)
                    for i, comment in enumerate(unanalyzed):
                        analysis_progress.progress((i + 1) / total_count)
                        status_text.text(f"🤖 AI 分析中: {i + 1}/{total_count}")

                        result = ai.analyze_comment(comment.get("text", ""))
                        if result:
                            analyses.append({
                                "comment_id": comment["id"],
                                "platform": platform,
                                "sentiment": result["sentiment"],
                                "intent": result["intent"],
                                "summary": result["summary"],
                                "model": st.session_state.get("openai_model", "gpt-3.5-turbo")
                            })

                    if analyses:
                        db.insert_analyses_batch(analyses)

                    progress_bar.progress(0.85)
                    status_text.text(f"✅ AI 分析完成 {len(analyses)} 条评论")

                    st.success(f"🤖 成功分析 {len(analyses) if analyses else 0} 条评论")

        # 步骤 5: 生成报告
        progress_bar.progress(0.9)
        status_text.text("📄 正在生成报告（含深度分析）...")

        report_gen = get_report_gen()
        import inspect
        sig = inspect.signature(report_gen.generate_report)
        kwargs = {
            "db": db,
            "post_id": normalized_post_id,
            "platform": platform,
            "post_info": post_info,
        }
        if "ai_analyzer" in sig.parameters:
            kwargs["ai_analyzer"] = ai
        report_path = report_gen.generate_report(**kwargs)

        progress_bar.progress(1.0)
        status_text.text("🎉 全部完成！")

        st.success(f"✅ 报告已生成: `{os.path.basename(report_path)}`")

        # 显示报告
        with open(report_path, 'r', encoding='utf-8') as f:
            report_content = f.read()

        st.markdown("---")
        st.subheader("📄 分析报告")

        with st.container(height=400):
            st.markdown(report_content)

        # 下载按钮
        col1, col2 = st.columns(2)
        with col1:
            st.download_button(
                label="⬇️ 下载报告",
                data=report_content,
                file_name=os.path.basename(report_path),
                mime="text/markdown",
                use_container_width=True
            )
        with col2:
            if st.button("🔄 继续分析新帖子", use_container_width=True):
                st.rerun()

    st.markdown("---")
    st.subheader("📋 支持的平台")
    cols = st.columns(3)
    platforms_list = list(PLATFORM_CONFIG.items())
    for i, (key, info) in enumerate(platforms_list):
        with cols[i % 3]:
            st.write(f"{info['icon']} {info['display_name']}")


def page_topic_search():
    """主题搜索分析页面：按关键词搜索相关帖子并生成汇总分析报告"""
    st.title("🔍 主题搜索分析")
    st.markdown("输入一个关键词/主题，自动搜索相关帖子并抓取评论，生成汇总分析报告")
    st.markdown("---")

    platform = st.session_state.selected_platform
    platform_info = PLATFORM_CONFIG[platform]

    st.info(f"当前平台: {platform_info['icon']} {platform_info['display_name']}（可在侧边栏切换平台）")

    if platform in ("douyin", "xiaohongshu"):
        st.caption("⚠️ 该平台搜索接口需要签名验证，属于实验性功能，可能因反爸升级而失败")
    elif platform == "weibo":
        st.caption("⚠️ 微博搜索接口对未登录访问限制较严，建议在侧边栏配置登录 Cookie 以提高成功率")
    elif platform == "twitter":
        st.caption("💡 需要 Twitter API v2 权限，只能搜索最近 7 天内的推文")

    keyword = st.text_input("🔎 搜索关键词/主题", placeholder="例如: python教程")

    col1, col2, col3 = st.columns(3)
    with col1:
        max_posts = st.slider("最多抓取帖子数", min_value=1, max_value=30, value=10, step=1)
    with col2:
        max_comments_per_post = st.slider("每个帖子最多评论数", min_value=10, max_value=300, value=50, step=10)
    with col3:
        st.write("")
        analyze_immediately = st.checkbox("自动 AI 分析", value=True)

    if st.button("🚀 开始搜索并分析", type="primary", use_container_width=True):
        if not keyword:
            st.error("请输入搜索关键词")
            return

        collector = get_collector(platform)
        if not collector:
            st.error(f"无法初始化 {platform_info['display_name']} 收集器")
            return

        progress_bar = st.progress(0)
        status_text = st.empty()

        status_text.text(f"🔍 正在搜索「{keyword}」相关帖子...")
        with st.spinner("搜索中..."):
            posts = collector.search_posts(keyword, max_posts=max_posts)

        if not posts:
            st.warning("⚠️ 未找到相关帖子，请更换关键词，或检查平台配置/登录 Cookie 是否正确")
            return

        st.success(f"✅ 找到 {len(posts)} 个相关帖子")
        progress_bar.progress(0.15)

        db = get_db()
        for p in posts:
            db.insert_post(p)

        ai = None
        if analyze_immediately:
            api_key = st.session_state.get("openai_api_key", "")
            if not api_key:
                st.warning("⚠️ 未配置 AI API Key，跳过 AI 分析步骤")
            else:
                ai = get_ai_analyzer()

        total_comments_fetched = 0
        for i, post in enumerate(posts):
            pid = post.get("id", "")
            post_label = (post.get("title") or post.get("content", "") or pid)[:30]

            status_text.text(f"📥 ({i + 1}/{len(posts)}) 拉取帖子评论: {post_label}")
            progress_bar.progress(0.15 + 0.55 * (i / len(posts)))

            with st.spinner(f"拉取第 {i + 1}/{len(posts)} 个帖子的评论..."):
                comments = collector.fetch_comments(pid, max_comments=max_comments_per_post)

            if comments:
                for c in comments:
                    c["post_id"] = pid
                    c["platform"] = platform
                total_comments_fetched += db.insert_comments_batch(comments)

            if ai:
                status_text.text(f"🤖 ({i + 1}/{len(posts)}) AI 分析中: {post_label}")
                unanalyzed = db.get_unanalyzed_comments(pid, platform)
                analyses = []
                for c in unanalyzed:
                    result = ai.analyze_comment(c.get("text", ""))
                    if result:
                        analyses.append({
                            "comment_id": c["id"],
                            "platform": platform,
                            "sentiment": result["sentiment"],
                            "intent": result["intent"],
                            "summary": result["summary"],
                            "model": st.session_state.get("openai_model", "gpt-3.5-turbo")
                        })
                if analyses:
                    db.insert_analyses_batch(analyses)

        progress_bar.progress(0.8)
        st.success(f"📥 共拉取 {total_comments_fetched} 条评论（涉及 {len(posts)} 个帖子）")

        status_text.text("📄 正在生成主题汇总报告...")
        report_gen = get_report_gen()
        report_path = report_gen.generate_topic_report(
            db=db,
            keyword=keyword,
            platform=platform,
            posts_info=posts,
            ai_analyzer=ai,
        )

        progress_bar.progress(1.0)
        status_text.text("🎉 全部完成！")

        st.success(f"✅ 报告已生成: `{os.path.basename(report_path)}`")

        with open(report_path, 'r', encoding='utf-8') as f:
            report_content = f.read()

        st.markdown("---")
        st.subheader("📄 主题汇总报告")
        with st.container(height=400):
            st.markdown(report_content)

        st.download_button(
            label="⬇️ 下载报告",
            data=report_content,
            file_name=os.path.basename(report_path),
            mime="text/markdown",
            use_container_width=True
        )


def page_reports():
    """历史报告页面"""
    st.title("📁 历史报告")
    st.markdown("---")

    report_dir = st.session_state.get("report_dir", "reports")

    if not os.path.exists(report_dir):
        st.info("📂 报告目录不存在")
        return

    reports = [f for f in os.listdir(report_dir) if f.endswith('.md')]

    if not reports:
        st.info("📂 暂无历史报告")
        return

    reports.sort(key=lambda x: os.path.getmtime(os.path.join(report_dir, x)), reverse=True)

    st.write(f"共 **{len(reports)}** 份报告")

    selected = st.selectbox(
        "选择报告",
        options=reports,
        format_func=lambda x: f"{x} ({datetime.fromtimestamp(os.path.getmtime(os.path.join(report_dir, x))).strftime('%Y-%m-%d %H:%M')})"
    )

    if selected:
        report_path = os.path.join(report_dir, selected)
        with open(report_path, 'r', encoding='utf-8') as f:
            content = f.read()

        st.markdown("---")
        with st.container(height=500):
            st.markdown(content)

        st.download_button(
            label="⬇️ 下载报告",
            data=content,
            file_name=selected,
            mime="text/markdown",
            use_container_width=True
        )


def main():
    """主函数"""
    init_config()
    page_config()
    sidebar()

    # 导航
    page = st.navigation([
        st.Page(page_one_click, title="🚀 一键分析", icon="🚀"),
        st.Page(page_topic_search, title="🔍 主题搜索分析", icon="🔍"),
        st.Page(page_home, title="📊 总览", icon="📊"),
        st.Page(page_fetch, title="🐦 拉取评论", icon="📥"),
        st.Page(page_analyze, title="🤖 AI 分析", icon="🤖"),
        st.Page(page_negative, title="⚠️ 负面评论", icon="⚠️"),
        st.Page(page_report, title="📄 生成报告", icon="📄"),
        st.Page(page_reports, title="📁 历史报告", icon="📁"),
        st.Page(page_persona, title="🎭 人设配置", icon="🎭"),
        st.Page(page_auto_reply, title="💬 自动回复", icon="💬"),
    ])

    page.run()


def page_persona():
    """人设配置页面"""
    st.title("🎭 人设与回复模板配置")
    st.markdown("---")

    db = get_db()

    # 获取所有产品
    products = db.get_all_products()

    # 产品管理
    st.subheader("📦 产品管理")
    col1, col2 = st.columns([3, 1])

    with col1:
        product_name = st.text_input("产品/游戏名称", placeholder="例如：《XX游戏》")
    with col2:
        st.write("")
        if st.button("➕ 添加产品", use_container_width=True):
            if product_name:
                db.insert_product(product_name)
                st.success(f"✅ 已添加产品: {product_name}")
                st.rerun()
            else:
                st.error("请输入产品名称")

    if products:
        st.write(f"已有 **{len(products)}** 个产品")

        # 选择产品
        selected_product_idx = st.selectbox(
            "选择产品",
            options=range(len(products)),
            format_func=lambda x: products[x].get("name", "未命名")
        )
        selected_product = products[selected_product_idx]
        product_id = selected_product["id"]

        st.markdown("---")

        # 人设管理
        st.subheader("🎭 人设配置")

        personas = db.get_personas_by_product(product_id)
        active_persona = db.get_active_persona(product_id)

        col1, col2 = st.columns([4, 1])
        with col1:
            persona_name = st.text_input("人设名称", placeholder="例如：官方客服、资深玩家")
        with col2:
            st.write("")
            if st.button("➕ 添加人设", use_container_width=True):
                if persona_name:
                    db.insert_persona(
                        product_id=product_id,
                        name=persona_name,
                        system_prompt="你是一个友好的客服，会耐心解答用户问题。",
                        description="",
                        style_keywords="亲切,专业,友好"
                    )
                    st.success(f"✅ 已添加人设: {persona_name}")
                    st.rerun()

        if personas:
            st.write(f"已有 **{len(personas)}** 个人设")

            # 人设列表
            for persona in personas:
                with st.expander(f"{'⭐' if persona.get('is_active') else '  '}{persona.get('name', '未命名')}", expanded=False):
                    is_active = persona.get("is_active") == 1

                    col1, col2, col3 = st.columns([1, 1, 1])
                    with col1:
                        if not is_active and st.button("⭐ 设为当前", key=f"set_active_{persona['id']}"):
                            db.set_active_persona(persona["id"], product_id)
                            st.success("已激活此人设")
                            st.rerun()
                    with col2:
                        if st.button("🗑️ 删除", key=f"del_persona_{persona['id']}"):
                            db.delete_persona(persona["id"])
                            st.rerun()
                    with col3:
                        st.write(f"状态: {'⭐ 激活中' if is_active else '未激活'}")

                    # 人设编辑
                    new_name = st.text_input("名称", value=persona.get("name", ""), key=f"name_{persona['id']}")
                    new_desc = st.text_area("描述", value=persona.get("description", ""), key=f"desc_{persona['id']}", height=60)
                    new_prompt = st.text_area(
                        "系统提示词（人设核心）",
                        value=persona.get("system_prompt", ""),
                        key=f"prompt_{persona['id']}",
                        height=100,
                        help="定义AI的角色和回复风格"
                    )
                    new_style = st.text_input(
                        "风格关键词",
                        value=persona.get("style_keywords", ""),
                        key=f"style_{persona['id']}",
                        help="用逗号分隔，如：亲切,专业,有趣"
                    )

                    if st.button("💾 保存人设", key=f"save_persona_{persona['id']}"):
                        db.update_persona(persona["id"], new_name, new_prompt, new_desc, new_style)
                        st.success("已保存")
                        st.rerun()

                    # 模板管理
                    st.markdown("---")
                    st.caption("📝 回复模板")
                    templates = db.get_templates_by_persona(persona["id"])

                    template_type = st.selectbox(
                        "模板类型",
                        options=["问候", "Bug反馈", "建议采纳", "疑问解答", "负面安抚", "通用"],
                        key=f"type_{persona['id']}"
                    )
                    template_content = st.text_area(
                        "模板内容",
                        placeholder="使用 {comment} 表示评论内容占位",
                        key=f"content_{persona['id']}",
                        height=80
                    )
                    template_keywords = st.text_input(
                        "触发关键词（逗号分隔）",
                        placeholder="bug,闪退,卡顿",
                        key=f"keywords_{persona['id']}"
                    )
                    template_priority = st.slider("优先级", 0, 10, 5, key=f"priority_{persona['id']}")

                    if st.button("➕ 添加模板", key=f"add_template_{persona['id']}"):
                        if template_content:
                            db.insert_template(persona["id"], template_type, template_content, template_keywords, template_priority)
                            st.success("已添加模板")
                            st.rerun()

                    if templates:
                        for t in templates:
                            with st.container(border=True):
                                col1, col2 = st.columns([4, 1])
                                with col1:
                                    st.write(f"**[{t.get('template_type', '')}]** {t.get('content', '')[:50]}...")
                                    if t.get("trigger_keywords"):
                                        st.caption(f"关键词: {t.get('trigger_keywords')}")
                                with col2:
                                    if st.button("🗑️", key=f"del_t_{t['id']}"):
                                        db.delete_template(t["id"])
                                        st.rerun()
    else:
        st.info("请先添加一个产品开始配置人设")


def page_auto_reply():
    """自动回复管理页面"""
    st.title("💬 自动回复管理")
    st.markdown("---")

    db = get_db()
    platform = st.session_state.selected_platform

    # 获取当前产品和人设
    products = db.get_all_products()
    if not products:
        st.warning("⚠️ 请先在「🎭 人设配置」页面添加产品和配置人设")
        return

    selected_product_idx = st.selectbox(
        "选择产品",
        options=range(len(products)),
        format_func=lambda x: products[x].get("name", "未命名")
    )
    selected_product = products[selected_product_idx]
    product_id = selected_product["id"]

    active_persona = db.get_active_persona(product_id)
    if not active_persona:
        st.warning("⚠️ 请先在「🎭 人设配置」页面为此产品配置并激活一个人设")
        return

    st.success(f"🎭 当前人设: {active_persona.get('name', '未命名')}")

    # 回复设置
    st.subheader("⚙️ 回复设置")

    col1, col2 = st.columns(2)
    with col1:
        like_threshold = st.slider("点赞阈值 (%)", 1, 20, 3, help="点赞数超过此比例的评论会被回复")
    with col2:
        reply_mode = st.selectbox("回复模式", options=["批量确认", "全自动"], help="批量确认：每条回复需确认后再发布；全自动：自动按模板发布")

    auto_mode = (reply_mode == "全自动")

    st.markdown("---")

    # 获取帖子
    all_posts = db.get_posts(platform)
    if not all_posts:
        st.info("👈 请先在「拉取评论」页面拉取评论")
        return

    post_options = [p.get('title', p.get('id', ''))[:50] or p.get('id', '') for p in all_posts]
    selected_post_idx = st.selectbox("选择帖子", options=range(len(post_options)), format_func=lambda x: post_options[x])
    selected_post = all_posts[selected_post_idx]
    post_id = selected_post.get("id", "")

    # 统计
    col1, col2, col3 = st.columns(3)
    total_comments = db.get_total_count(post_id, platform)
    pending_replies = db.get_pending_replies(post_id, platform)
    reply_stats = db.get_reply_stats(post_id, platform)

    with col1:
        st.metric("📝 总评论", total_comments)
    with col2:
        st.metric("⏳ 待发布", len(pending_replies))
    with col3:
        st.metric("✅ 已发布", reply_stats.get("published", 0))

    st.markdown("---")

    # 初始化回复管理器
    reply_mgr = ReplyManager(db)

    # 生成回复按钮
    if st.button("🔍 筛选并生成回复", type="primary", use_container_width=True):
        # 获取已分析的评论
        analyzed_comments = db.get_all_comments_with_analysis(post_id, platform)
        if not analyzed_comments:
            st.warning("⚠️ 该帖子暂无分析数据，请先进行 AI 分析")
        else:
            # 获取帖子点赞数
            post_like_count = selected_post.get("like_count", 0)

            # 筛选需要回复的评论
            comments_to_reply = reply_mgr.filter_comments_for_reply(
                analyzed_comments,
                post_like_count,
                like_threshold
            )

            if not comments_to_reply:
                st.info("🤔 没有需要回复的评论")
            else:
                st.success(f"找到 **{len(comments_to_reply)}** 条需要回复的评论")

                # 获取模板
                templates = db.get_templates_by_persona(active_persona["id"])

                # 获取 AI 分析器
                ai_key = st.session_state.get("openai_api_key", "")
                ai = None
                if ai_key:
                    ai = get_ai_analyzer()

                reply_mgr.ai_analyzer = ai

                # 生成回复
                with st.spinner("🤖 正在生成回复..."):
                    generated = reply_mgr.generate_batch_replies(
                        comments_to_reply,
                        active_persona,
                        templates,
                        platform
                    )

                # 保存回复
                saved = reply_mgr.save_replies(generated)
                st.success(f"✅ 已生成并保存 **{saved}** 条回复")

                if not auto_mode:
                    st.rerun()

    st.markdown("---")

    # 待发布回复列表
    st.subheader("📋 待发布回复")

    pending = db.get_pending_replies(post_id, platform)
    if not pending:
        st.info("暂无待发布的回复")
    else:
        # 收集器
        collector = get_collector(platform)

        # 检查是否支持回复
        can_reply = hasattr(collector, "reply_comment")
        if not can_reply:
            st.warning("⚠️ 当前平台收集器不支持回复功能")
        elif platform == "bilibili":
            sessdata = st.session_state.get("bilibili_sessdata", "")
            bili_jct = st.session_state.get("bilibili_bili_jct", "")
            if not sessdata or not bili_jct:
                st.warning("⚠️ B站回复需要配置 SESSDATA 和 bili_jct Cookie")

        for reply in pending:
            with st.container(border=True):
                col1, col2 = st.columns([4, 1])
                with col1:
                    st.write(f"**原评论**: {reply.get('original_comment', '')[:80]}...")
                    st.caption(f"❤️ {reply.get('like_count', 0)} | {reply.get('intent', '')} | {reply.get('_reply_reason', '')}")

                    # 回复编辑
                    new_reply = st.text_area(
                        "AI 生成回复",
                        value=reply.get("generated_reply", ""),
                        key=f"reply_{reply['id']}",
                        height=60
                    )

                with col2:
                    st.write(f"情感: {reply.get('sentiment', '')}")
                    st.write(f"意图: {reply.get('intent', '')}")

                    if can_reply and st.button("📤 发布", key=f"publish_{reply['id']}", use_container_width=True):
                        with st.spinner(f"正在发布（间隔 {BILIBILI_REPLY_INTERVAL} 秒）..."):
                            # 更新回复内容
                            if new_reply != reply.get("generated_reply"):
                                reply["generated_reply"] = new_reply

                            success, msg = reply_mgr.publish_reply(reply, collector)
                            if success:
                                st.success("✅ 发布成功")
                                time.sleep(BILIBILI_REPLY_INTERVAL)
                                st.rerun()
                            else:
                                st.error(f"❌ 发布失败: {msg}")

                    if st.button("❌ 跳过", key=f"skip_{reply['id']}", use_container_width=True):
                        db.update_reply_status(reply["id"], "skipped")
                        st.rerun()

        # 批量发布按钮
        if can_reply:
            st.markdown("---")
            if st.button("📤 批量发布全部", type="primary", use_container_width=True):
                reply_mgr = ReplyManager(db)
                collector = get_collector(platform)

                progress_bar = st.progress(0)
                status_text = st.empty()

                results = {"success": 0, "failed": 0}

                for i, reply in enumerate(pending):
                    progress_bar.progress((i + 1) / len(pending))
                    status_text.text(f"正在发布 {i + 1}/{len(pending)}...")

                    success, msg = reply_mgr.publish_reply(reply, collector)
                    if success:
                        results["success"] += 1
                    else:
                        results["failed"] += 1

                    if i < len(pending) - 1:
                        time.sleep(BILIBILI_REPLY_INTERVAL)

                st.success(f"✅ 发布完成！成功: {results['success']}, 失败: {results['failed']}")
                st.rerun()

    # 回复日志
    st.markdown("---")
    st.subheader("📜 回复日志")

    logs = db.get_reply_logs(limit=20)
    if logs:
        for log in logs[:10]:
            status_icon = "✅" if log.get("status") == "success" else "❌"
            st.write(f"{status_icon} [{log.get('platform', '')}] {log.get('reply_text', '')[:50]}... - {log.get('created_at', '')[:19]}")
            if log.get("error_message"):
                st.caption(f"   错误: {log.get('error_message', '')[:100]}")
    else:
        st.info("暂无回复记录")

    page.run()


if __name__ == "__main__":
    main()
