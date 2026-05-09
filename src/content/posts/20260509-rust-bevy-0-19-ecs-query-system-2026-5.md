---
title: "Rust Bevy 0.19 ECS Query System マイグレーション完全ガイド｜既存プロジェクト破壊的変更対応【2026年5月最新】"
description: "Bevy 0.19の新ECSクエリシステムへの移行手順を徹底解説。破壊的変更への対応方法、パフォーマンス35%向上の実装詳細、実践的なコード移行例を完全網羅。"
category: "game-dev"
tags: ["Rust", "Bevy", "ECS", "クエリシステム", "マイグレーション"]
publishedAt: 2026-05-09
featured: false
---

Rustゲームエンジン Bevy の最新版 0.19 が2026年5月にリリースされ、ECS（Entity Component System）のクエリシステムに大幅な破壊的変更が加えられました。この変更により、既存プロジェクトのコードは動作しなくなりますが、正しく移行すれば**クエリ実行速度が最大35%向上**し、より表現力豊かなシステム設計が可能になります。

本記事では、Bevy 0.19 の新クエリシステムの技術詳細、既存プロジェクトの移行手順、パフォーマンス最適化のベストプラクティスを実装例とともに解説します。公式リリースノート、GitHubのマイグレーションガイド、コミュニティフォーラムの実装報告を総合的に調査し、実務で即使える情報をまとめました。

## Bevy 0.19 クエリシステムの破壊的変更とは

Bevy 0.19では、クエリフィルタとクエリアクセスの型システムが完全に再設計されました。従来の `Query<&Component>` や `Query<&mut Component, With<Marker>>` といった記法が廃止され、新しい型安全なAPIに置き換えられています。

### 主な破壊的変更（2026年5月リリース）

1. **`QueryState` の導入**: クエリの状態管理が明示的に
2. **フィルタ構文の変更**: `With<T>`、`Without<T>` の記述位置が厳格化
3. **`QueryIter` の型変更**: イテレータの借用ルールが明確化
4. **`Param` トレイトの再設計**: システムパラメータの型推論が強化

これらの変更により、コンパイル時のクエリ検証が厳格化され、実行時エラーが大幅に減少します。

以下のダイアグラムは、Bevy 0.18から0.19へのクエリシステムアーキテクチャ変更を示しています。

```mermaid
flowchart TD
    A["Bevy 0.18 クエリシステム"] --> B["Query&lt;&Component&gt;"]
    A --> C["暗黙的な型推論"]
    A --> D["実行時借用チェック"]
    
    E["Bevy 0.19 クエリシステム"] --> F["QueryState&lt;Q, F&gt;"]
    E --> G["明示的なフィルタ型"]
    E --> H["コンパイル時検証強化"]
    
    B -.移行.-> F
    C -.移行.-> G
    D -.移行.-> H
    
    F --> I["型安全性向上"]
    G --> J["フィルタ組み合わせ最適化"]
    H --> K["実行時オーバーヘッド35%削減"]
```

このアーキテクチャ変更により、クエリのキャッシング戦略が改善され、Entity アーキタイプ変更時の再計算コストが削減されています。

### パフォーマンス向上の技術的背景

新クエリシステムでは、以下の最適化が施されています。

- **アーキタイプマッチングの高速化**: Entity のコンポーネント構成（アーキタイプ）とクエリの照合アルゴリムが刷新され、O(n) から O(log n) に改善
- **フィルタチェーンの最適化**: 複数のフィルタ条件を並列評価するSIMD命令の活用
- **キャッシュ局所性の改善**: クエリ結果のメモリレイアウトが連続化され、CPUキャッシュヒット率が向上

公式ベンチマークでは、10万Entityを含むシーンでの複雑なクエリ実行時間が平均35%短縮されました（Bevy 0.18比）。

## 既存プロジェクトの移行手順：ステップバイステップガイド

既存の Bevy 0.18 プロジェクトを 0.19 に移行する際の具体的な手順を解説します。

### Step 1: 依存関係の更新

`Cargo.toml` を以下のように更新します。

```toml
[dependencies]
bevy = "0.19"  # 2026年5月8日リリース
```

この時点で `cargo build` を実行すると、大量のコンパイルエラーが発生しますが、これは想定内です。

### Step 2: クエリ型の書き換え

最も頻出する変更は、クエリパラメータの型指定です。

**Bevy 0.18 の記法**:
```rust
fn movement_system(
    mut query: Query<(&mut Transform, &Velocity), With<Player>>
) {
    for (mut transform, velocity) in query.iter_mut() {
        transform.translation += velocity.0;
    }
}
```

**Bevy 0.19 の記法**:
```rust
fn movement_system(
    mut query: Query<(&mut Transform, &Velocity), QueryFilter<With<Player>>>
) {
    for (mut transform, velocity) in query.iter_mut() {
        transform.translation += velocity.0;
    }
}
```

変更点は `With<Player>` を `QueryFilter<With<Player>>` で明示的にラップすることです。これにより、コンパイラがフィルタ型を正確に推論できます。

### Step 3: 複数フィルタの組み合わせ

複雑なクエリ条件の記述方法が変更されました。

**Bevy 0.18**:
```rust
Query<&Transform, (With<Enemy>, Without<Dead>)>
```

**Bevy 0.19**:
```rust
Query<&Transform, QueryFilter<(With<Enemy>, Without<Dead>)>>
```

`QueryFilter` 内でタプルを使った論理AND条件を記述します。論理OR条件には新しく導入された `Or<(A, B)>` フィルタを使用します。

```rust
// Enemy または Boss タグを持つEntityをクエリ
Query<&Transform, QueryFilter<Or<(With<Enemy>, With<Boss>)>>>
```

以下のシーケンス図は、新しいクエリシステムでのフィルタ評価プロセスを示しています。

```mermaid
sequenceDiagram
    participant S as System
    participant Q as QueryState
    participant A as Archetype Cache
    participant E as Entity Storage
    
    S->>Q: query.iter_mut()
    Q->>A: フィルタ条件でアーキタイプ検索
    A->>A: With<Player> & Without<Dead> を評価
    A-->>Q: マッチしたアーキタイプリスト
    Q->>E: 該当Entityのコンポーネント取得
    E-->>Q: (&mut Transform, &Velocity) データ
    Q-->>S: イテレータを返却
    
    loop 各Entity
        S->>S: transform.translation 更新
    end
```

このシーケンスでは、アーキタイプキャッシュの事前フィルタリングにより、不要なEntityへのアクセスが排除されています。

### Step 4: `QueryState` への明示的な変更（高度なケース）

動的にクエリを構築する場合、`QueryState` を直接使用します。

**Bevy 0.18**:
```rust
let mut state = world.query::<&Transform>();
for transform in state.iter(&world) {
    // ...
}
```

**Bevy 0.19**:
```rust
let mut state = world.query_filtered::<&Transform, QueryFilter<With<Player>>>();
for transform in state.iter(&world) {
    // ...
}
```

`query_filtered` メソッドが導入され、フィルタ型を明示的に指定する必要があります。

### Step 5: システムパラメータの型推論エラー対応

一部のケースで、型推論が失敗する場合があります。

```rust
// コンパイルエラー: 型推論の曖昧性
fn spawn_system(mut commands: Commands, query: Query<&Transform>) {
    // ...
}
```

この場合、フィルタ型を明示します。

```rust
fn spawn_system(
    mut commands: Commands, 
    query: Query<&Transform, QueryFilter<()>>  // 空フィルタを明示
) {
    // ...
}
```

## パフォーマンス最適化のベストプラクティス

Bevy 0.19の新クエリシステムを最大限活用するための実装テクニックを紹介します。

### クエリの再利用とキャッシング

頻繁に実行されるクエリは、`QueryState` を使ってキャッシュします。

```rust
#[derive(Resource)]
struct CachedQueries {
    player_query: QueryState<(&Transform, &mut Health), QueryFilter<With<Player>>>,
}

fn init_cached_queries(mut commands: Commands, world: &mut World) {
    commands.insert_resource(CachedQueries {
        player_query: world.query_filtered::<(&Transform, &mut Health), QueryFilter<With<Player>>>(),
    });
}

fn damage_system(mut cached: ResMut<CachedQueries>, world: &World) {
    for (transform, mut health) in cached.player_query.iter_mut(world) {
        health.current -= 10.0;
    }
}
```

この方法により、クエリのアーキタイプマッチング処理が1回だけ実行され、以降は結果が再利用されます。

### フィルタの順序最適化

複数のフィルタ条件を使う場合、選択性の高い条件を先に配置します。

```rust
// 悪い例：選択性の低いフィルタが先
Query<&Transform, QueryFilter<(With<Renderable>, With<RareComponent>)>>

// 良い例：レアなコンポーネントを先にフィルタ
Query<&Transform, QueryFilter<(With<RareComponent>, With<Renderable>)>>
```

Bevy 0.19では、フィルタ評価がショートサーキット最適化されるため、早期に絞り込むことで不要な評価を削減できます。

### アーキタイプの安定化

Entityのコンポーネント構成（アーキタイプ）が頻繁に変わると、クエリキャッシュが無効化されます。

```rust
// 悪い例：毎フレームコンポーネントを追加/削除
fn bad_system(mut commands: Commands, query: Query<Entity, QueryFilter<With<Player>>>) {
    for entity in query.iter() {
        commands.entity(entity).remove::<TemporaryTag>();
        commands.entity(entity).insert(TemporaryTag);
    }
}

// 良い例：状態をコンポーネント内のフラグで管理
#[derive(Component)]
struct PlayerState {
    is_invincible: bool,
}

fn good_system(mut query: Query<&mut PlayerState, QueryFilter<With<Player>>>) {
    for mut state in query.iter_mut() {
        state.is_invincible = !state.is_invincible;
    }
}
```

アーキタイプを安定させることで、クエリの実行時オーバーヘッドが最小化されます。

## 大規模プロジェクトでの移行戦略

数万行規模のゲームプロジェクトを移行する際の実践的なアプローチを紹介します。

### 段階的移行のアプローチ

一度にすべてを書き換えるのではなく、モジュール単位で移行します。

1. **テストカバレッジの確認**: 移行前に既存の動作を確認するテストを追加
2. **コンパイルエラーの一覧化**: `cargo build 2>&1 | tee errors.log` でエラーをファイル出力
3. **優先度の設定**: クリティカルパスのシステムから移行
4. **自動リファクタリングツールの活用**: `cargo fix` や正規表現置換を併用

### 自動化可能な変更の一括処理

正規表現を使った一括置換で対応可能な変更もあります。

```bash
# Query<T, With<M>> を Query<T, QueryFilter<With<M>>> に置換
find . -name "*.rs" -exec sed -i 's/Query<\(.*\), \(With<.*>\)>/Query<\1, QueryFilter<\2>>/g' {} +
```

ただし、複雑なケースは手動での確認が必要です。

### 移行後の検証

移行後は、以下の点を確認します。

- **パフォーマンスプロファイリング**: `cargo flamegraph` でクエリの実行時間を計測
- **メモリ使用量の確認**: `heaptrack` でメモリリークがないか確認
- **統合テストの実行**: ゲームプレイ全体が正常に動作するか確認

以下のフローチャートは、大規模プロジェクトの移行判断プロセスを示しています。

```mermaid
flowchart TD
    Start["Bevy 0.19 移行開始"] --> Check["既存テストの確認"]
    Check --> |"カバレッジ不足"| AddTests["テスト追加"]
    Check --> |"十分"| Compile["cargo build 実行"]
    AddTests --> Compile
    
    Compile --> Errors["エラー一覧取得"]
    Errors --> Categorize["エラー種別分類"]
    
    Categorize --> Simple["単純置換可能"]
    Categorize --> Complex["手動対応必要"]
    
    Simple --> AutoFix["正規表現一括置換"]
    Complex --> Manual["手動リファクタリング"]
    
    AutoFix --> Verify1["コンパイル確認"]
    Manual --> Verify1
    
    Verify1 --> |"エラー残存"| Categorize
    Verify1 --> |"成功"| Test["統合テスト実行"]
    
    Test --> |"失敗"| Debug["デバッグ"]
    Test --> |"成功"| Profile["パフォーマンス計測"]
    
    Debug --> Manual
    Profile --> Done["移行完了"]
```

このフローに従うことで、大規模プロジェクトでも段階的に安全に移行できます。

## トラブルシューティング：よくある移行エラーと解決策

実際の移行作業で遭遇しやすいエラーとその対処法をまとめます。

### エラー1: `the trait bound QueryFilter<With<T>> is not satisfied`

**原因**: フィルタ型の記述ミス

**解決策**: `QueryFilter` の内側に正しいフィルタ型を配置

```rust
// NG
Query<&Transform, With<QueryFilter<Player>>>

// OK
Query<&Transform, QueryFilter<With<Player>>>
```

### エラー2: `cannot infer type for type parameter F`

**原因**: フィルタ型の省略による型推論の失敗

**解決策**: 空フィルタを明示

```rust
// NG（型推論失敗）
Query<&Transform>

// OK
Query<&Transform, QueryFilter<()>>
```

### エラー3: `multiple mutable borrows`

**原因**: 同じコンポーネントへの複数の可変借用

**解決策**: クエリを分割するか、`ParamSet` を使用

```rust
// NG
fn system(
    mut query1: Query<&mut Transform, QueryFilter<With<Player>>>,
    mut query2: Query<&mut Transform, QueryFilter<With<Enemy>>>
) {
    // Transformへの可変借用が競合
}

// OK: ParamSet で分離
fn system(
    mut params: ParamSet<(
        Query<&mut Transform, QueryFilter<With<Player>>>,
        Query<&mut Transform, QueryFilter<With<Enemy>>>
    )>
) {
    for mut transform in params.p0().iter_mut() { /* Player処理 */ }
    for mut transform in params.p1().iter_mut() { /* Enemy処理 */ }
}
```

### エラー4: `QueryState::update must be called before iteration`

**原因**: `QueryState` の更新忘れ

**解決策**: イテレーション前に `update` を呼ぶ

```rust
let mut state = world.query_filtered::<&Transform, QueryFilter<With<Player>>>();
state.update_archetypes(&world);  // 必須
for transform in state.iter(&world) {
    // ...
}
```

## まとめ

Bevy 0.19 の新クエリシステムへの移行は、以下のステップで安全かつ効率的に実施できます。

- **型システムの理解**: `QueryFilter<T>` による明示的なフィルタ型指定が必須
- **段階的移行**: モジュール単位で移行し、テストで動作を確認
- **パフォーマンス最適化**: クエリキャッシング、フィルタ順序最適化、アーキタイプ安定化を実施
- **トラブルシューティング**: 型推論エラーや借用チェックエラーへの対処法を把握

正しく移行すれば、クエリ実行速度が最大35%向上し、型安全性も向上します。既存プロジェクトの規模に応じて、自動化と手動対応を組み合わせることで、移行コストを最小化できます。

2026年5月リリースの Bevy 0.19 は、今後のゲーム開発における ECS パフォーマンスの新しい基準となる重要なアップデートです。本記事の移行ガイドを参考に、スムーズなバージョンアップを実現してください。

## 参考リンク

- [Bevy 0.19 Release Notes - GitHub](https://github.com/bevyengine/bevy/releases/tag/v0.19.0)
- [Bevy 0.19 Migration Guide - Official Documentation](https://bevyengine.org/learn/migration-guides/0.18-0.19/)
- [Query System Redesign RFC - Bevy Community](https://github.com/bevyengine/rfcs/blob/main/rfcs/78-query-system-redesign.md)
- [Bevy ECS Performance Benchmarks - GitHub Discussions](https://github.com/bevyengine/bevy/discussions/15234)
- [Rust Bevy 0.19 新機能解説（日本語）- Qiita](https://qiita.com/tags/bevy)