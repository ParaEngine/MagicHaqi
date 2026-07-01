"""
AI 分析模块
集成 OpenAI API，对每条评论进行情感分析、意图分类和摘要生成。
包含错误处理和重试机制，确保分析的可靠性。
"""

import json
import time
from typing import List, Dict, Optional
from openai import OpenAI, APIError, APIConnectionError, RateLimitError


class AIAnalyzer:
    """AI 评论分析器"""

    # 允许的情感类型
    VALID_SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE"]

    # 允许的意图类型
    VALID_INTENTS = ["INQUIRY", "FEEDBACK", "COMPLAINT", "SPAM", "OTHER"]

    # 系统提示词，定义分析任务和输出格式
    SYSTEM_PROMPT = """你是一个专业的社交媒体评论分析专家。请对用户提供的评论进行分析，并以严格的 JSON 格式返回结果。

分析维度：
1. sentiment: 情感倾向
   - POSITIVE: 正面积极（赞美、感谢、支持、喜欢等）
   - NEUTRAL: 中性客观（陈述事实、提问、无明显情感倾向等）
   - NEGATIVE: 负面消极（批评、抱怨、不满、愤怒等）

2. intent: 用户意图
   - INQUIRY: 咨询提问（询问信息、寻求帮助、提出疑问等）
   - FEEDBACK: 反馈建议（提供建议、分享感受、评价产品等）
   - COMPLAINT: 投诉抱怨（表达不满、投诉问题、要求解决等）
   - SPAM: 垃圾广告（推广、营销、刷屏、无意义内容等）
   - OTHER: 其他（无法归类到以上类型的内容）

3. summary: 一句话总结评论的核心内容（不超过 50 字）

输出要求：
- 只返回 JSON 数据，不要有任何其他文字说明
- JSON 包含三个字段：sentiment, intent, summary
- sentiment 和 intent 必须使用大写的枚举值
- summary 使用中文，简洁明了

示例输出：
{"sentiment": "POSITIVE", "intent": "FEEDBACK", "summary": "用户对产品表示满意，称赞界面设计很美观"}
"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-3.5-turbo",
        max_retries: int = 3,
        retry_delay: float = 2.0
    ):
        """
        初始化 AI 分析器

        Args:
            api_key: OpenAI API Key
            base_url: API 基础 URL
            model: 使用的模型名称
            max_retries: 最大重试次数
            retry_delay: 重试延迟秒数
        """
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )
        self.model = model
        self.max_retries = max_retries
        self.retry_delay = retry_delay

    def analyze_comment(self, comment_text: str) -> Optional[Dict]:
        """
        分析单条评论

        Args:
            comment_text: 评论文本

        Returns:
            分析结果字典，包含 sentiment, intent, summary
        """
        if not comment_text or not comment_text.strip():
            return {
                "sentiment": "NEUTRAL",
                "intent": "OTHER",
                "summary": "空评论"
            }

        for attempt in range(self.max_retries):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self.SYSTEM_PROMPT},
                        {"role": "user", "content": comment_text}
                    ],
                    temperature=0.3,
                    max_tokens=200,
                    response_format={"type": "json_object"}
                )

                result_text = response.choices[0].message.content.strip()
                result = self._parse_analysis_result(result_text)

                if result:
                    return result

                print(f"[AI分析] 第 {attempt + 1} 次尝试结果格式无效，重试中...")

            except RateLimitError as e:
                wait_time = self.retry_delay * (attempt + 1)
                print(f"[AI分析] 触发限流，等待 {wait_time} 秒后重试 ({attempt + 1}/{self.max_retries})")
                time.sleep(wait_time)

            except (APIError, APIConnectionError) as e:
                wait_time = self.retry_delay * (attempt + 1)
                print(f"[AI分析] API 错误: {e}，等待 {wait_time} 秒后重试 ({attempt + 1}/{self.max_retries})")
                time.sleep(wait_time)

            except Exception as e:
                print(f"[AI分析] 未知错误: {e}")
                break

        print(f"[AI分析] 评论分析失败，已重试 {self.max_retries} 次")
        return None

    def _parse_analysis_result(self, result_text: str) -> Optional[Dict]:
        """
        解析 AI 返回的分析结果

        Args:
            result_text: AI 返回的文本

        Returns:
            解析后的字典，失败返回 None
        """
        try:
            result = json.loads(result_text)

            # 验证必要字段
            if not all(key in result for key in ["sentiment", "intent", "summary"]):
                print(f"[AI分析] 缺少必要字段: {result.keys()}")
                return None

            # 验证情感类型
            sentiment = result["sentiment"].upper().strip()
            if sentiment not in self.VALID_SENTIMENTS:
                print(f"[AI分析] 无效的情感类型: {sentiment}")
                sentiment = "NEUTRAL"

            # 验证意图类型
            intent = result["intent"].upper().strip()
            if intent not in self.VALID_INTENTS:
                print(f"[AI分析] 无效的意图类型: {intent}")
                intent = "OTHER"

            # 确保摘要不超过 200 字符
            summary = str(result["summary"]).strip()[:200]
            if not summary:
                summary = "无摘要"

            return {
                "sentiment": sentiment,
                "intent": intent,
                "summary": summary
            }

        except json.JSONDecodeError as e:
            print(f"[AI分析] JSON 解析失败: {e}")
            return None

    def analyze_comments_batch(
        self,
        comments: List[Dict],
        progress_callback=None
    ) -> List[Dict]:
        """
        批量分析评论

        Args:
            comments: 评论列表，每条评论需包含 id 和 text 字段
            progress_callback: 进度回调函数，参数为 (当前索引, 总数)

        Returns:
            分析结果列表，每条包含 comment_id, sentiment, intent, summary
        """
        results = []
        total = len(comments)

        print(f"[AI分析] 开始批量分析 {total} 条评论...")

        for i, comment in enumerate(comments):
            comment_id = comment.get("id")
            comment_text = comment.get("text", "")

            if not comment_id:
                continue

            # 进度回调
            if progress_callback:
                progress_callback(i + 1, total)

            # 分析评论
            analysis = self.analyze_comment(comment_text)

            if analysis:
                result = {
                    "comment_id": comment_id,
                    "sentiment": analysis["sentiment"],
                    "intent": analysis["intent"],
                    "summary": analysis["summary"],
                    "model": self.model
                }
                results.append(result)

            # 每 10 条打印一次进度
            if (i + 1) % 10 == 0 or (i + 1) == total:
                print(f"[AI分析] 进度: {i + 1}/{total}")

        print(f"[AI分析] 批量分析完成，成功 {len(results)} 条，失败 {total - len(results)} 条")
        return results

    def analyze_deep_insights(
        self,
        comments: List[Dict],
        platform: str = "twitter"
    ) -> Optional[Dict]:
        """
        深度分析：从大量评论中提取痛点、Bug、改进建议和问题优先级

        Args:
            comments: 评论列表，每条需包含 text, sentiment, intent, like_count 等
            platform: 平台名称

        Returns:
            深度分析结果字典
        """
        if not comments:
            return None

        print(f"[AI深度分析] 开始深度分析 {len(comments)} 条评论...")

        comments_text = ""
        for i, c in enumerate(comments[:50]):
            text = c.get("text", "")[:200]
            like = c.get("like_count", 0)
            sentiment = c.get("sentiment", "")
            intent = c.get("intent", "")
            comments_text += f"{i+1}. [点赞{like}] [{sentiment}] [{intent}] {text}\n"

        platform_styles = {
            "bilibili": "B站用户，年轻、爱玩梗",
            "xiaohongshu": "小红书用户，注重体验、种草风",
            "douyin": "抖音用户，短视频爱好者",
            "weibo": "微博用户，关注热点",
            "twitter": "Twitter用户，关注科技",
        }
        platform_style = platform_styles.get(platform, "社交媒体用户")

        prompt = f"""你是一个专业的产品分析师。请分析以下 {min(len(comments), 50)} 条{platform_style}的评论，提取有价值的洞察。

## 评论列表
{comments_text}

## 分析任务
请完成以下四个维度的分析，并以严格的 JSON 格式返回结果：

1. **pain_points** (用户反馈痛点):
   - 提取用户最常抱怨、最困扰的问题
   - 按提及频率和严重程度排序
   - 每条包含：title (痛点标题), description (详细描述), count (提及次数估算), severity (严重程度1-5), example (典型评论摘录)

2. **bug_reports** (Bug反馈):
   - 提取用户报告的具体Bug和技术问题
   - 按影响范围排序
   - 每条包含：title (Bug标题), description (Bug描述), steps (重现步骤/现象), count (提及次数估算), severity (严重程度1-5), example (典型评论摘录)

3. **improvement_suggestions** (改进建议):
   - 提取用户提出的功能建议、优化建议
   - 按价值和可行性排序
   - 每条包含：title (建议标题), description (建议描述), value (价值评估1-5), feasibility (可行性1-5), example (典型评论摘录)

4. **priority_ranking** (问题优先级排序):
   - 综合考虑：影响范围、严重程度、用户诉求强度
   - 按优先级从高到低排序所有问题
   - 每条包含：rank (排名), issue (问题标题), category (分类: 痛点/Bug/建议), reason (排序理由), urgency (紧急程度1-5)

## 输出要求
- 只返回 JSON 数据，不要任何其他文字说明
- 每个类别至少提取3-5条最有价值的
- 痛点和Bug要区分开：痛点是体验问题，Bug是功能故障
- 改进建议要是建设性的、可落地的
- 优先级排序要综合考虑点赞数、情感强烈程度、提及频率
- 所有文本用中文

示例格式：
{{
  "pain_points": [
    {{"title": "...", "description": "...", "count": 5, "severity": 4, "example": "..."}}
  ],
  "bug_reports": [...],
  "improvement_suggestions": [...],
  "priority_ranking": [...]
}}
"""

        for attempt in range(self.max_retries):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": "你是一个专业的产品分析师，擅长从用户评论中提取有价值的洞察。"},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.4,
                    max_tokens=3000,
                    response_format={"type": "json_object"}
                )

                result_text = response.choices[0].message.content.strip()
                result = json.loads(result_text)

                if all(k in result for k in ["pain_points", "bug_reports", "improvement_suggestions", "priority_ranking"]):
                    print("[AI深度分析] 深度分析完成")
                    return result
                else:
                    print(f"[AI深度分析] 第 {attempt + 1} 次尝试格式不完整，重试中...")

            except RateLimitError as e:
                wait_time = self.retry_delay * (attempt + 1)
                print(f"[AI深度分析] 触发限流，等待 {wait_time} 秒后重试")
                time.sleep(wait_time)
            except (APIError, APIConnectionError) as e:
                wait_time = self.retry_delay * (attempt + 1)
                print(f"[AI深度分析] API 错误: {e}，等待 {wait_time} 秒后重试")
                time.sleep(wait_time)
            except Exception as e:
                print(f"[AI深度分析] 未知错误: {e}")
                break

        print("[AI深度分析] 深度分析失败")
        return None
