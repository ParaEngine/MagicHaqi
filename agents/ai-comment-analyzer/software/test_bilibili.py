"""
B站发布功能调试脚本
分步骤验证：连接 → 拉取评论 → 发布回复
"""

import os
import sys
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

def test_1_connection():
    """测试1：B站连接测试"""
    print("\n" + "="*60)
    print("🧪 测试1：B站连接测试")
    print("="*60)

    from platforms.bilibili import BilibiliCollector

    sessdata = os.getenv("BILIBILI_SESSDATA", "")
    bili_jct = os.getenv("BILIBILI_BILI_JCT", "")

    print(f"SESSDATA: {'已配置' if sessdata else '❌ 未配置'}")
    print(f"bili_jct:  {'已配置' if bili_jct else '❌ 未配置'}")

    if not sessdata:
        print("❌ 请先配置 BILIBILI_SESSDATA")
        return False

    try:
        collector = BilibiliCollector(sessdata, bili_jct)
        # 测试获取用户信息
        nav_result = collector.test_connection()
        print(f"连接测试: {nav_result}")
        return True
    except Exception as e:
        print(f"❌ 连接失败: {e}")
        return False


def test_2_fetch_comments():
    """测试2：拉取评论"""
    print("\n" + "="*60)
    print("🧪 测试2：拉取评论")
    print("="*60)

    from platforms.bilibili import BilibiliCollector

    sessdata = os.getenv("BILIBILI_SESSDATA", "")
    bili_jct = os.getenv("BILIBILI_BILI_JCT", "")

    # 使用一个测试视频
    test_bvid = input("请输入测试视频 BV号 (直接回车用默认): ").strip()
    if not test_bvid:
        test_bvid = "BV1GJ411x7h7"  # 测试用
        print(f"使用默认测试视频: {test_bvid}")

    try:
        collector = BilibiliCollector(sessdata, bili_jct)

        # 获取视频信息
        video_info = collector.get_post_info(test_bvid)
        if video_info:
            print(f"✅ 获取视频信息成功")
            print(f"   标题: {video_info.get('title', '')[:50]}")
            print(f"   作者: {video_info.get('author', '')}")
            print(f"   评论数: {video_info.get('comment_count', 0)}")
            aid = video_info.get("aid", "")
        else:
            print("❌ 获取视频信息失败")
            return None, None, None

        # 拉取评论
        comments = collector.fetch_comments(test_bvid, max_count=5)
        print(f"\n✅ 成功拉取 {len(comments)} 条评论")

        if comments:
            print("\n前3条评论预览:")
            for i, c in enumerate(comments[:3]):
                print(f"  [{i+1}] {c.get('author', '')}: {c.get('text', '')[:60]}")
                print(f"       rpid: {c.get('id', '')[:20]}...  点赞: {c.get('like_count', 0)}")

        return collector, test_bvid, comments

    except Exception as e:
        print(f"❌ 拉取评论失败: {e}")
        import traceback
        traceback.print_exc()
        return None, None, None


def test_3_publish_reply(collector, comments, bvid):
    """测试3：发布回复"""
    print("\n" + "="*60)
    print("🧪 测试3：发布回复")
    print("="*60)

    if not collector or not comments:
        print("❌ 跳过：没有收集器或评论")
        return

    # 选择一条评论测试回复
    test_comment = comments[0]
    rpid = test_comment.get("id", "")
    author = test_comment.get("author_username", "")
    text = test_comment.get("text", "")[:50]

    print(f"\n目标评论:")
    print(f"  作者: {author}")
    print(f"  内容: {text}")
    print(f"  rpid: {rpid}")
    print(f"  bvid: {bvid}")

    reply_text = input("\n请输入回复内容 (输入 skip 跳过): ").strip()
    if reply_text.lower() == "skip":
        print("⏭️ 跳过发布测试")
        return
    if not reply_text:
        reply_text = "感谢反馈！（测试回复）"

    print(f"\n回复内容: {reply_text}")
    confirm = input("确认发布? (y/N): ").strip().lower()

    if confirm == "y":
        print("\n📤 正在发布...")
        try:
            result = collector.reply_comment(rpid, reply_text, bvid=bvid)
            if result.get("success"):
                print(f"✅ 发布成功！")
                print(f"   新回复 rpid: {result.get('rpid', '')}")
                return True
            else:
                print(f"❌ 发布失败: {result.get('error', '未知错误')}")
                print(f"   错误代码: {result.get('code', 'N/A')}")
                if result.get('raw'):
                    print(f"   原始返回: {result.get('raw')}")
                return False
        except Exception as e:
            print(f"❌ 发布异常: {e}")
            import traceback
            traceback.print_exc()
            return False
    else:
        print("⏭️ 已取消")
        return None


def main():
    """主函数"""
    print("="*60)
    print("  B站发布功能调试工具")
    print("="*60)

    # 测试1：连接
    if not test_1_connection():
        print("\n❌ 连接测试失败，请检查配置")
        return

    # 测试2：拉取评论
    collector, bvid, comments = test_2_fetch_comments()
    if not collector:
        print("\n❌ 拉取评论失败")
        return

    # 测试3：发布回复
    if comments:
        result = test_3_publish_reply(collector, comments, bvid)
    else:
        print("\nℹ️ 没有评论，跳过发布测试")

    print("\n" + "="*60)
    print("  调试完成")
    print("="*60)


if __name__ == "__main__":
    main()
