"""
配置管理模块
将用户配置保存到 .env 文件
"""

import os
from pathlib import Path


def get_config_path() -> Path:
    """获取配置文件路径"""
    base_dir = Path(__file__).parent.parent
    return base_dir / ".env"


def load_config() -> dict:
    """从 .env 文件加载配置"""
    config = {}
    config_path = get_config_path()

    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    config[key.strip()] = value.strip()

    return config


def save_config(updates: dict) -> bool:
    """保存配置到 .env 文件"""
    config_path = get_config_path()

    # 读取现有配置
    existing = load_config()

    # 合并配置
    existing.update(updates)

    # 写入文件
    try:
        with open(config_path, 'w', encoding='utf-8') as f:
            f.write("# AI回复总结评论 - 配置\n")
            f.write("# 此文件包含敏感信息，请勿泄露\n\n")
            for key, value in sorted(existing.items()):
                # 隐藏敏感值的显示
                if any(s in key.lower() for s in ['token', 'key', 'secret', 'password', 'cookie', 'sessdata', 'bili_jct']):
                    display_value = value[:8] + "..." if len(value) > 8 else "******"
                else:
                    display_value = value
                f.write(f"{key}={value}\n")

        return True
    except Exception as e:
        print(f"保存配置失败: {e}")
        return False


def get_config(key: str, default: str = "") -> str:
    """获取配置项"""
    config = load_config()
    return config.get(key, default)


def set_config(key: str, value: str) -> bool:
    """设置配置项"""
    return save_config({key: value})


def set_platform_config(platform: str, configs: dict) -> bool:
    """保存平台配置"""
    updates = {}
    for key, value in configs.items():
        env_key = f"{platform.upper()}_{key.upper()}"
        updates[env_key] = value
    return save_config(updates)


def get_platform_config(platform: str) -> dict:
    """获取平台配置"""
    config = load_config()
    platform_configs = {}

    # 平台配置的环境变量前缀映射
    platform_env_prefix = {
        "twitter": "TWITTER",
        "bilibili": "BILIBILI",
        "xiaohongshu": "XHS",
        "weibo": "WEIBO",
        "douyin": "DOUYIN",
    }

    prefix = platform_env_prefix.get(platform, platform.upper())
    for key, value in config.items():
        if key.startswith(f"{prefix}_"):
            config_key = key[len(f"{prefix}_"):].lower()
            platform_configs[config_key] = value

    return platform_configs
