"""
平台基类
定义统一的评论收集接口，所有平台都继承自此基类
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional


class BaseCollector(ABC):
    """评论收集器基类"""

    # 平台名称（子类必须实现）
    platform_name = "base"
    # 平台显示名称
    platform_display_name = "Base"

    def __init__(self, **kwargs):
        """
        初始化收集器

        Args:
            **kwargs: 平台特定的配置参数
        """
        pass

    @abstractmethod
    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """
        获取帖子/视频基本信息

        Args:
            post_id: 帖子/视频 ID 或 URL

        Returns:
            帖子信息字典，失败返回 None
            字段：
            - id: 帖子 ID
            - title: 标题
            - content: 内容/描述
            - author_id: 作者 ID
            - author_name: 作者名称
            - author_avatar: 作者头像
            - created_at: 创建时间 ISO 格式
            - like_count: 点赞数
            - comment_count: 评论数
            - share_count: 分享数
            - view_count: 浏览数
            - platform: 平台名称
            - url: 帖子链接
        """
        pass

    @abstractmethod
    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """
        拉取评论

        Args:
            post_id: 帖子/视频 ID 或 URL
            max_comments: 最大评论数，None 表示全部

        Returns:
            评论列表，每条评论包含：
            - id: 评论 ID
            - post_id: 帖子 ID
            - platform: 平台名称
            - author_id: 作者 ID
            - author_username: 作者用户名
            - author_name: 作者昵称
            - author_avatar: 作者头像
            - text: 评论内容
            - created_at: 创建时间 ISO 格式
            - like_count: 点赞数
            - reply_count: 回复数
            - ip_location: IP 属地（可选）
            - platform_data: 平台原始数据
        """
        pass

    def validate_config(self) -> bool:
        """
        验证配置是否完整

        Returns:
            配置是否有效
        """
        return True

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """
        从 URL 或 ID 中提取帖子 ID

        Args:
            url_or_id: URL 或 ID

        Returns:
            帖子 ID
        """
        return url_or_id.strip()
