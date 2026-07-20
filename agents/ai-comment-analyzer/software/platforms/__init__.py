"""
平台模块
"""

from .base import BaseCollector
from .factory import CollectorFactory
from .xiaohongshu_publisher import XiaohongshuPublisher, PublishResult
from .douyin_publisher import DouyinPublisher, DouyinPublishResult
from .wechat_mp import WechatMPPublisher, WechatPublishResult

__all__ = [
    "BaseCollector",
    "CollectorFactory",
    "XiaohongshuPublisher",
    "PublishResult",
    "DouyinPublisher",
    "DouyinPublishResult",
    "WechatMPPublisher",
    "WechatPublishResult",
]
