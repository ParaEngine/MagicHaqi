"""
平台工厂
根据平台名称创建对应的收集器实例
"""

from typing import Dict, Type, Optional
from .base import BaseCollector


class CollectorFactory:
    """收集器工厂"""

    _collectors: Dict[str, Type[BaseCollector]] = {}

    @classmethod
    def register(cls, platform: str, collector_class: Type[BaseCollector]):
        """注册平台收集器"""
        cls._collectors[platform.lower()] = collector_class

    @classmethod
    def create(cls, platform: str, **kwargs) -> Optional[BaseCollector]:
        """
        创建平台收集器实例

        Args:
            platform: 平台名称
            **kwargs: 平台配置参数

        Returns:
            收集器实例，失败返回 None
        """
        collector_class = cls._collectors.get(platform.lower())
        if not collector_class:
            return None
        return collector_class(**kwargs)

    @classmethod
    def get_available_platforms(cls) -> Dict[str, dict]:
        """
        获取所有可用平台信息

        Returns:
            平台信息字典 {platform: {name, display_name, description}}
        """
        platforms = {}
        for key, collector_cls in cls._collectors.items():
            platforms[key] = {
                "name": key,
                "display_name": collector_cls.platform_display_name,
                "description": getattr(collector_cls, "platform_description", ""),
            }
        return platforms

    @classmethod
    def get_platform_display_name(cls, platform: str) -> str:
        """获取平台显示名称"""
        collector_cls = cls._collectors.get(platform.lower())
        if collector_cls:
            return collector_cls.platform_display_name
        return platform


# 注册所有平台
from .bilibili import BilibiliCollector
from .xiaohongshu import XiaohongshuCollector
from .weibo import WeiboCollector
from .douyin import DouyinCollector
from .taptap import TapTapCollector
from .tieba import TiebaCollector
from .wechat_mp.collector import WechatMPCollector

# Twitter 已移除
CollectorFactory.register("bilibili", BilibiliCollector)
CollectorFactory.register("b站", BilibiliCollector)
CollectorFactory.register("xiaohongshu", XiaohongshuCollector)
CollectorFactory.register("xhs", XiaohongshuCollector)
CollectorFactory.register("小红书", XiaohongshuCollector)
CollectorFactory.register("weibo", WeiboCollector)
CollectorFactory.register("微博", WeiboCollector)
CollectorFactory.register("douyin", DouyinCollector)
CollectorFactory.register("抖音", DouyinCollector)
CollectorFactory.register("taptap", TapTapCollector)
CollectorFactory.register("TapTap", TapTapCollector)
CollectorFactory.register("tieba", TiebaCollector)
CollectorFactory.register("贴吧", TiebaCollector)
CollectorFactory.register("wechat_mp", WechatMPCollector)
CollectorFactory.register("wechat", WechatMPCollector)
CollectorFactory.register("公众号", WechatMPCollector)
