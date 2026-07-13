"""
微信公众号模块 (WeChat MP Module)

基于 topic-to-wechat 的发布引擎 + 微信官方评论管理 API。
提供: 草稿发布 / 评论采集 / 评论回复 / 封面生成 / Markdown排版
"""

from .publisher import WechatMPPublisher, WechatPublishResult
from .collector import WechatMPCollector

__all__ = ["WechatMPPublisher", "WechatPublishResult", "WechatMPCollector"]
