---
title: "LLM APIプロンプトエンジニアリング実践テクニック集"
description: "LLM APIを最大限活用するプロンプトエンジニアリングの実践テクニック。構造化出力・Chain-of-Thought・関数呼び出しまで、コード例付きで解説"
category: "ai-development"
tags: ["LLM", "プロンプトエンジニアリング", "API", "実践テクニック"]
publishedAt: 2026-04-08
featured: false
---

2026年、LLM APIは開発者にとって「使えると便利」な技術から「使えないと競争力を失う」基盤技術へと変化した。OpenAI GPT-5.4、Claude Opus 4.6、Gemini 3 Proといったフロンティアモデルは、適切なプロンプトを与えれば驚異的な成果を返すが、雑なプロンプトでは期待外れの結果しか得られない。

本記事では、LLM APIを本番環境で活用するための**プロンプトエンジニアリング実践テクニック**を、実装可能なコード例とともに体系的に解説する。

## プロンプトエンジニアリングの3つのレベル

2026年現在、LLM APIにおけるプロンプトの精度管理は3つのレベルに分類できる。

**レベル1: プロンプトのみ（成功率80〜95%）**
自然言語の指示だけでモデルの出力を制御する。手軽だが、エッジケースで予期しないフォーマットの応答が返るリスクがある。

**レベル2: Function Calling / Tool Use（成功率95〜99%）**
JSONスキーマをモデルに渡し、構造化された応答を得る。スキーマはヒントとして機能するが、厳密な制約ではない。

**レベル3: ネイティブ構造化出力（成功率100%）**
Constrained Decodingにより、JSONスキーマに完全準拠した出力を生成時点で保証する。2026年の本番環境ではこのレベルが標準だ。

```python
# レベル別の実装比較

# レベル1: プロンプトのみ（非推奨）
response = client.messages.create(
    model="claude-opus-4-6",
    messages=[{
        "role": "user",
        "content": "以下のレビューの感情分析をJSON形式で返してください: '素晴らしい製品'"
    }]
)
# → 自由形式のテキスト。JSONとは限らない

# レベル2: Tool Use
response = client.messages.create(
    model="claude-opus-4-6",
    tools=[{
        "name": "analyze_sentiment",
        "description": "テキストの感情分析",
        "input_schema": {
            "type": "object",
            "properties": {
                "sentiment": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1}
            },
            "required": ["sentiment", "confidence"]
        }
    }],
    messages=[{"role": "user", "content": "感情分析: '素晴らしい製品'"}]
)
# → 高確率でスキーマ準拠だが保証なし

# レベル3: ネイティブ構造化出力（推奨）
from pydantic import BaseModel

class SentimentResult(BaseModel):
    sentiment: str  # positive / negative / neutral
    confidence: float

# OpenAI の場合
response = client.beta.chat.completions.parse(
    model="gpt-5.4",
    response_format=SentimentResult,
    messages=[{"role": "user", "content": "感情分析: '素晴らしい製品'"}]
)
result = response.choices[0].message.parsed
# → 100%スキーマ準拠が保証される
```

## System Promptの設計テクニック

System Promptは、LLM APIのプロンプトエンジニアリングにおける土台だ。ここで定義したルールがすべての応答に影響する。

### ロールプロンプティング

モデルに明確な役割を与えることで、応答の専門性と一貫性が大幅に向上する。

```python
system_prompt = """あなたはシニアTypeScriptエンジニアです。
以下の原則に従ってコードレビューを行ってください:

1. 型安全性: any型の使用、型アサーションの乱用を指摘する
2. パフォーマンス: 不要な再レンダリング、メモリリークを検出する
3. セキュリティ: XSS、インジェクション、認証バイパスの可能性を警告する
4. 保守性: 命名規則、関数の責務分離、テスタビリティを評価する

出力形式:
- 各指摘に重要度（Critical/Warning/Info）を付与
- 修正コード例を必ず提示
- 指摘がない場合は「LGTM」とだけ返す"""
```

### コンテキストエンジニアリング

2026年のプロンプトエンジニアリングでは、単なるプロンプトの最適化を超えて**コンテキスト全体の設計**が重視されている。System Promptに加えて、以下の要素を最適に配置する。

```python
messages = [
    # 1. システム指示（役割・ルール・出力形式）
    {"role": "system", "content": system_prompt},

    # 2. 参照ドキュメント（RAGで取得した関連情報）
    {"role": "user", "content": f"参考ドキュメント:\n{retrieved_docs}"},
    {"role": "assistant", "content": "ドキュメントを確認しました。"},

    # 3. Few-shot例（期待する入出力パターン）
    {"role": "user", "content": "レビュー対象:\n```ts\nconst data: any = fetchData();\n```"},
    {"role": "assistant", "content": "[Critical] any型の使用...(修正例)"},

    # 4. 実際のユーザー入力
    {"role": "user", "content": f"レビュー対象:\n```ts\n{user_code}\n```"}
]
```

この配置順序は重要だ。LLMは**先頭と末尾の情報に強くバイアスされる**（Primacy-Recency Effect）ため、最も重要なルールをSystem Promptの冒頭に、ユーザー入力を末尾に配置する。

## Chain-of-Thought プロンプトエンジニアリング実践

Chain-of-Thought（CoT）は、LLMに段階的な推論プロセスを踏ませることで、複雑な問題の正答率を大幅に向上させるテクニックだ。

### 基本的なCoTプロンプト

```python
# 単純な指示（CoTなし）→ 誤答リスクが高い
prompt_simple = "このSQLクエリのパフォーマンス問題を特定してください"

# CoTプロンプト → 段階的推論で精度向上
prompt_cot = """このSQLクエリのパフォーマンス問題を特定してください。

以下のステップで分析してください:
1. テーブル構造とインデックスの状態を推定する
2. クエリの実行計画を推測する
3. ボトルネックとなる操作（フルスキャン、ソート等）を特定する
4. 具体的な改善策を提案する

各ステップの推論過程を明示してから、最終的な結論を述べてください。"""
```

### 構造化出力とCoTの併用

2026年のベストプラクティスは、**推論フェーズと出力フェーズを分離**することだ。推論時は自由形式で考えさせ、最終出力だけを構造化する。

```python
from pydantic import BaseModel
from typing import List

class PerformanceIssue(BaseModel):
    location: str        # 問題のある箇所
    severity: str        # high / medium / low
    description: str     # 問題の説明
    fix: str             # 修正案

class AnalysisResult(BaseModel):
    reasoning: str                    # 推論過程（自由形式）
    issues: List[PerformanceIssue]    # 構造化された結果

response = client.beta.chat.completions.parse(
    model="gpt-5.4",
    response_format=AnalysisResult,
    messages=[
        {"role": "system", "content": "SQLパフォーマンスアナリストとして分析してください。"
                                       "reasoningフィールドに段階的な推論過程を記述し、"
                                       "issuesフィールドに構造化された結果を出力してください。"},
        {"role": "user", "content": f"分析対象:\n```sql\n{sql_query}\n```"}
    ]
)

# 推論過程はログに保存、構造化結果はアプリケーションで使用
analysis = response.choices[0].message.parsed
logger.info(f"推論過程: {analysis.reasoning}")
for issue in analysis.issues:
    process_issue(issue)
```

## Few-Shotプロンプトエンジニアリングの実践テクニック

Few-Shotプロンプティングは、期待する入出力の例を数件提示することで、モデルの応答パターンを正確に制御するテクニックだ。

### 効果的なFew-Shotの構成

```python
def build_few_shot_messages(examples, user_input):
    messages = [
        {"role": "system", "content": (
            "ユーザーのコード断片から、適切なユニットテストを生成してください。"
            "テストフレームワークはVitest、アサーションはexpectを使用します。"
        )}
    ]

    # Few-shot例を追加（3〜5例が最適）
    for example in examples:
        messages.append({"role": "user", "content": example["input"]})
        messages.append({"role": "assistant", "content": example["output"]})

    # 実際のユーザー入力
    messages.append({"role": "user", "content": user_input})
    return messages

# Few-shot例の定義
examples = [
    {
        "input": "```ts\nfunction add(a: number, b: number): number { return a + b; }\n```",
        "output": """```ts
import { describe, it, expect } from 'vitest';
import { add } from './math';

describe('add', () => {
  it('正の数同士を足す', () => {
    expect(add(2, 3)).toBe(5);
  });
  it('負の数を含む計算', () => {
    expect(add(-1, 5)).toBe(4);
  });
  it('ゼロとの計算', () => {
    expect(add(0, 0)).toBe(0);
  });
});
```"""
    }
]
```

Few-Shotの例は**3〜5件が最適**とされている。1件では不十分で出力が不安定になり、7件以上ではコンテキストを消費する割に精度向上が頭打ちになる。また、**良い例だけでなく悪い例**も含めると効果的だ。

## Function CallingによるLLM APIの実践的活用

Function Calling（Tool Use）は、LLMが自律的に外部ツールを選択・呼び出す仕組みだ。APIとLLMを組み合わせたアプリケーション構築の基盤となる。

```python
import anthropic
import json

client = anthropic.Anthropic()

# ツール定義
tools = [
    {
        "name": "search_database",
        "description": "商品データベースを検索する",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "検索キーワード"},
                "category": {
                    "type": "string",
                    "enum": ["electronics", "clothing", "food"],
                    "description": "商品カテゴリ"
                },
                "max_results": {
                    "type": "integer",
                    "default": 10,
                    "description": "最大取得件数"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "calculate_shipping",
        "description": "配送料を計算する",
        "input_schema": {
            "type": "object",
            "properties": {
                "weight_kg": {"type": "number", "description": "重量(kg)"},
                "destination": {"type": "string", "description": "配送先都道府県"}
            },
            "required": ["weight_kg", "destination"]
        }
    }
]

# ツール実行ループ
def run_agent(user_message: str):
    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            tools=tools,
            messages=messages
        )

        # テキスト応答なら完了
        if response.stop_reason == "end_turn":
            return extract_text(response)

        # ツール呼び出しがあれば実行
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = execute_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, ensure_ascii=False)
                    })

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

# ツールの実際の実行
def execute_tool(name: str, inputs: dict):
    if name == "search_database":
        return db.search(inputs["query"], inputs.get("category"))
    elif name == "calculate_shipping":
        return shipping.calculate(inputs["weight_kg"], inputs["destination"])
```

このエージェントループパターンは、LLM APIのプロンプトエンジニアリングにおける最も実践的な設計パターンの一つだ。LLMが必要なツールを自ら選択し、結果を踏まえて次のアクションを決定する。

## プロンプト圧縮テクニックでAPI コストを最適化

LLM APIの利用コストはトークン数に比例する。プロンプトの品質を維持しつつトークン数を削減する**プロンプト圧縮**は、本番環境での実践に欠かせないテクニックだ。

```python
# 圧縮前: 冗長なプロンプト（約200トークン）
prompt_verbose = """
あなたにお願いしたいのは、以下に示すユーザーレビューのテキストを読んで、
そのレビューがポジティブな感情を表しているのか、ネガティブな感情を表しているのか、
それともどちらでもないニュートラルな感情なのかを判断していただくことです。
判断した結果を、sentiment というキーに対して positive, negative, neutral の
いずれかの値を設定したJSON形式で出力してください。
また、その判断にどの程度自信があるかを confidence というキーに対して
0から1の間の小数値で設定してください。
"""

# 圧縮後: 必要十分なプロンプト（約50トークン）
prompt_compressed = """感情分析を実行。出力: {"sentiment": "positive|negative|neutral", "confidence": 0.0-1.0}"""

# さらなる最適化: 構造化出力を使えばプロンプトすら不要
# スキーマ定義自体が指示として機能する
```

**プロンプト圧縮の3原則**は以下の通りだ。

1. **冗長な敬語・前置きを排除**: 「あなたにお願いしたいのは」→ 不要
2. **スキーマで代替できる指示は削除**: 出力形式の説明は構造化出力に任せる
3. **要約ベースの圧縮**: 長い参照ドキュメントは事前に要約してからコンテキストに含める

## メタプロンプトエンジニアリングの実践

メタプロンプティングは、**LLMにプロンプトを生成させる**上級テクニックだ。より強力なモデルでプロンプトを設計し、軽量なモデルで実行することでコストと品質を両立する。

```python
# Step 1: 強力なモデルでプロンプトを生成
meta_response = client.messages.create(
    model="claude-opus-4-6",
    messages=[{
        "role": "user",
        "content": """以下のタスクに最適なSystem Promptを設計してください。

タスク: ECサイトの商品レビューから、購入判断に役立つ要点を3つ抽出する
対象モデル: claude-sonnet-4-6（高速・低コストモデル）
制約: 出力は日本語、箇条書き3項目、各50文字以内

最適なSystem Promptを出力してください。"""
    }]
)
optimized_prompt = extract_text(meta_response)

# Step 2: 生成されたプロンプトを軽量モデルで実行
production_response = client.messages.create(
    model="claude-sonnet-4-6",  # 低コストモデル
    system=optimized_prompt,
    messages=[{"role": "user", "content": review_text}]
)
```

このアプローチにより、**設計コスト（Opus利用料）は初回のみ発生**し、本番では低コストのSonnetで高品質な出力を得られる。プロンプトの設計は一度行えば数千〜数万回の実行で償却されるため、費用対効果は非常に高い。

## プロンプトのバージョン管理と評価の実践

プロンプトエンジニアリングは「書いて終わり」ではない。本番環境では**バージョン管理と継続的な評価**が不可欠だ。

```python
# プロンプトのバージョン管理
PROMPTS = {
    "sentiment_v1": {
        "system": "感情分析を実行してください",
        "version": "1.0.0",
        "created": "2026-03-01"
    },
    "sentiment_v2": {
        "system": "シニアデータアナリストとして感情分析を実行。"
                   "文脈・皮肉・婉曲表現を考慮すること。",
        "version": "2.0.0",
        "created": "2026-03-15"
    }
}

# A/Bテストによる評価
import random

async def analyze_sentiment(text: str):
    # トラフィックの10%を新プロンプトに割り振り
    variant = "sentiment_v2" if random.random() < 0.1 else "sentiment_v1"

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        system=PROMPTS[variant]["system"],
        messages=[{"role": "user", "content": text}]
    )

    # 結果とバリアント情報をログに記録
    logger.info({
        "variant": variant,
        "input": text,
        "output": response,
        "latency_ms": elapsed
    })

    return response
```

プロンプトをコードと同様にバージョン管理し、A/Bテストで新旧を比較評価する。本番へのロールアウトは段階的に行い、品質劣化が検出された場合は即座にロールバックできる体制を整えておくことが重要だ。

## まとめ

- **構造化出力**を使え。2026年のLLM APIで本番運用するなら、ネイティブ構造化出力（レベル3）が必須。Pydantic/Zodでスキーマを定義し、100%のスキーマ準拠を保証する
- **System Prompt**は土台。ロールプロンプティングとコンテキストエンジニアリングで応答品質を底上げする
- **Chain-of-Thought**は推論精度を劇的に向上させる。推論フェーズ（自由形式）と出力フェーズ（構造化）を分離するのが2026年のベストプラクティス
- **Few-Shot**は3〜5例が最適。良い例と悪い例の両方を含めると効果的
- **Function Calling**でエージェントループを構築。LLMが自律的にツールを選択・実行する設計パターンが主流
- **プロンプト圧縮**でAPIコストを削減。冗長な指示を排除し、構造化出力にフォーマット定義を委譲する
- **メタプロンプティング**で高品質プロンプトを自動生成。Opusで設計、Sonnetで実行のパターンが費用対効果に優れる
- プロンプトは**バージョン管理とA/Bテスト**で継続的に改善する。感覚ではなくデータで品質を判断する
