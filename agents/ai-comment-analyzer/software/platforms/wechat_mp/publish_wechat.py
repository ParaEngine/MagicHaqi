#!/usr/bin/env python3
"""
微信公众号草稿发布入口脚本。
topic-to-wechat 内置，不依赖 content-publisher。

用法:
  python3 publish_wechat.py publish --workspace /path/to/workspace
  python3 publish_wechat.py publish --workspace /path/to/workspace --auto-publish
  python3 publish_wechat.py status --workspace /path/to/workspace --publish-id ID
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from publish.wechat import WeChatPublisher


def cmd_publish(args):
    publisher = WeChatPublisher(args.workspace)
    try:
        result = publisher.full_publish_flow(auto_publish=args.auto_publish)
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False, indent=2))
        sys.exit(1)


def cmd_status(args):
    publisher = WeChatPublisher(args.workspace)
    try:
        publisher.authenticate()
        result = publisher.get_status(args.publish_id)
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False, indent=2))
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="WeChat Official Account publisher (topic-to-wechat)"
    )
    subparsers = parser.add_subparsers(dest="command")

    pub = subparsers.add_parser("publish", help="Publish to WeChat (draft by default)")
    pub.add_argument("-w", "--workspace", required=True, help="Workspace directory")
    pub.add_argument("--auto-publish", action="store_true", help="Auto-publish after draft")
    pub.set_defaults(func=cmd_publish)

    st = subparsers.add_parser("status", help="Check publish status")
    st.add_argument("-w", "--workspace", required=True, help="Workspace directory")
    st.add_argument("--publish-id", required=True, help="Publish task ID")
    st.set_defaults(func=cmd_status)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
