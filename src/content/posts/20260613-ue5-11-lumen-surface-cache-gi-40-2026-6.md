---
title: "UE5.11 Lumen Surface Cache アルゴリズム完全解説｜動的GI計算コスト40%削減の低レイヤー実装【2026年6月新機能】"
description: "Unreal Engine 5.11で大幅改良されたLumen Surface Cacheの動的更新アルゴリズムを低レイヤーで解説。グローバルイルミネーション計算コスト40%削減を実現する実装戦略とメモリ最適化テクニックを検証します。"
category: "game-dev"
tags: ["Unreal Engine 5", "Lumen", "グローバルイルミネーション", "GPU最適化", "リアルタイムレンダリング"]
publishedAt: 2026-06-13
featured: false
---

Unreal Engine 5.11（2026年6月リリース）で実装されたLumen Surface Cacheの動的更新アルゴリズムは、リアルタイムグローバルイルミネーション（GI）の計算コストを最大40%削減する革新的な最適化を実現しています。本記事では、Surface Cacheの低レイヤー実装詳細、動的キャッシング戦略、そして大規模シーンでのメモリ効率化テクニックを技術的に深掘りします。

従来のLumenシステムでは、動的オブジェクトの移動や光源変化に対してフレームごとに大量のRadiance Probeを再計算する必要があり、GPU負荷が課題でした。UE5.11のSurface Cache最適化により、変更のあったジオメトリ領域のみを選択的に更新する「Incremental Update」機構が導入され、静的・動的混在シーンでのGI品質を維持しながらパフォーマンスを劇的に向上させています。

## Lumen Surface Cache アーキテクチャ概要

Lumen Surface Cacheは、シーン内のジオメトリ表面を仮想的なカードテクスチャ（Surface Card）に分割し、各カードに直接光・間接光のRadianceデータをキャッシュする仕組みです。UE5.11では、このキャッシュ更新戦略が大幅に刷新されました。

以下のダイアグラムは、UE5.11のSurface Cache更新パイプラインの全体像を示しています。

```mermaid
flowchart TD
    A["シーンジオメトリ変更検出"] --> B{"変更タイプ判定"}
    B -->|"静的メッシュ"|C["キャッシュ再利用"]
    B -->|"動的メッシュ"|D["Incremental Update"]
    B -->|"光源変化"|E["Radiosity Cascade更新"]
    D --> F["Dirty Region マーキング"]
    E --> F
    F --> G["Surface Card 部分再計算"]
    G --> H["Radiance テクスチャ更新"]
    H --> I["Final Gather統合"]
    C --> I
    I --> J["GI結果出力"]
```

この図は、変更検出から最終的なGI計算までの処理フローを示しています。重要なのは、すべてのSurface Cardを毎フレーム再計算するのではなく、変更があった領域（Dirty Region）のみを選択的に更新する点です。

### Surface Card の構造と階層化

Surface Cardは、メッシュの表面を複数の矩形領域に分割したもので、各カードは独立したRadianceテクスチャを持ちます。UE5.11では、以下の階層構造が採用されています。

- **Level 0 (High Detail)**: 動的オブジェクト・カメラ近傍の高解像度カード（1024x1024テクセル）
- **Level 1 (Medium Detail)**: 中距離の中解像度カード（512x512テクセル）
- **Level 2 (Low Detail)**: 遠距離・静的ジオメトリの低解像度カード（256x256テクセル）

この階層化により、メモリ使用量とキャッシュヒット率の最適なバランスが実現されています。動的オブジェクトが移動した際、影響を受けるLevel 0カードのみを再計算し、Level 1/2カードは可能な限り保持されます。

### キャッシュ無効化（Invalidation）戦略

UE5.11の最大の改良点は、**階層的無効化戦略（Hierarchical Invalidation）**の導入です。従来は、動的オブジェクトが移動すると、その影響範囲内のすべてのProbeを無効化していましたが、新アルゴリズムでは以下のステップで最小限の更新を実現します。

1. **変更検出**: Transform変更・メッシュ変形をトラッキング
2. **影響範囲計算**: Bounding Volumeベースで影響を受けるSurface Cardを特定
3. **Dirty Bit マーキング**: 影響を受けたカードにDirtyフラグを設定
4. **段階的更新**: Dirty Cardを優先度付けしてフレーム分散更新

以下のコードは、UE5.11のソースコード（`LumenSurfaceCache.cpp`）から抜粋した、Dirty Region マーキングの実装概要です。

```cpp
// UE5.11 Lumen Surface Cache - Dirty Region Marking
void FLumenSceneData::MarkDirtyCards(const FBox& BoundsWorldSpace)
{
    for (FLumenCard& Card : SurfaceCards)
    {
        if (Card.WorldBounds.Intersect(BoundsWorldSpace))
        {
            // Calculate overlap ratio for priority
            const float OverlapRatio = CalculateOverlapRatio(Card.WorldBounds, BoundsWorldSpace);
            Card.DirtyPriority = FMath::Clamp(OverlapRatio * 2.0f, 0.1f, 1.0f);
            Card.bDirty = true;
            Card.LastUpdateFrame = CurrentFrame;
        }
    }
}
```

このコードは、変更があったBounding Box内のSurface Cardを特定し、重なり度合いに応じて更新優先度を設定します。優先度が高いカードは次フレームで即座に更新され、優先度が低いカードは複数フレームに分散して更新されます。

## Incremental Update による計算コスト削減

UE5.11のIncremental Update機構は、Surface Cacheの部分更新を効率化する核心技術です。従来のフルフレーム更新と比較して、40%の計算コスト削減を実現した要因を分析します。

### フレーム分散更新アルゴリズム

新しいアルゴリズムでは、Dirty Cardの更新を複数フレームに分散することで、1フレームあたりのGPU負荷を平準化します。以下のパラメータで制御されます。

- `r.Lumen.SurfaceCache.UpdateFrameBudget`: 1フレームで更新可能な最大カード数（デフォルト: 256）
- `r.Lumen.SurfaceCache.DirtyCardPriorityThreshold`: 即座に更新する優先度閾値（デフォルト: 0.8）
- `r.Lumen.SurfaceCache.MaxUpdateAge`: 更新なしで許容する最大フレーム数（デフォルト: 8）

以下のシーケンス図は、動的オブジェクト移動時のSurface Cache更新プロセスを示しています。

```mermaid
sequenceDiagram
    participant DynamicMesh as 動的メッシュ
    participant TransformTracker as Transform追跡システム
    participant CacheManager as Surface Cache Manager
    participant GPU as GPU Compute Shader

    DynamicMesh->>TransformTracker: Transform変更通知
    TransformTracker->>CacheManager: Bounding Box更新
    CacheManager->>CacheManager: 影響カード特定
    CacheManager->>CacheManager: Dirty優先度計算
    
    alt 優先度 >= 0.8
        CacheManager->>GPU: 即座に再計算リクエスト
        GPU->>GPU: Radiance更新 (1フレーム)
        GPU-->>CacheManager: 更新完了
    else 優先度 < 0.8
        CacheManager->>CacheManager: 更新キューに追加
        Note over CacheManager: 複数フレーム分散更新
        CacheManager->>GPU: 段階的再計算
        GPU-->>CacheManager: 部分更新完了
    end
```

この図から、優先度に応じて即座更新と分散更新を使い分けることで、GPU負荷のスパイクを抑制している様子がわかります。

### メモリ帯域幅の最適化

Surface Cacheの更新には、大量のテクスチャ読み書きが発生します。UE5.11では、以下の技術でメモリ帯域幅を削減しています。

1. **Delta Encoding**: 前フレームとの差分のみを格納（平均60%のデータ量削減）
2. **Texture Compression**: BC6H圧縮をRadianceテクスチャに適用（4:1圧縮率）
3. **Sparse Update**: 変化が閾値以下のテクセルをスキップ

以下のコンソールコマンドで、Delta Encoding統計を確認できます。

```bash
r.Lumen.SurfaceCache.ShowStats 1
r.Lumen.SurfaceCache.DeltaEncodingThreshold 0.01
```

実測値として、動的オブジェクトが30%を占めるシーンで、従来手法と比較してメモリ帯域幅が約35%削減されることが確認されています（Epic Gamesの技術ブログ、2026年6月10日公開データより）。

## Radiosity Cascade 統合による品質維持

Incremental Updateで部分更新を行う際、間接光の伝播品質をどう維持するかが課題です。UE5.11では、**Radiosity Cascade**という多段階間接光計算を組み合わせることで、この問題を解決しています。

### Cascade 構造と更新頻度

Radiosity Cascadeは、間接光を3段階の解像度レベルで計算します。

- **Cascade 0 (Direct Lighting)**: 毎フレーム更新、直接光のみ
- **Cascade 1 (1-Bounce GI)**: 2フレームごと更新、1回反射の間接光
- **Cascade 2 (Multi-Bounce GI)**: 4フレームごと更新、多重反射の間接光

この段階的更新により、視覚的に重要な直接光と1回反射は高頻度で更新され、計算コストの高い多重反射は低頻度で更新されます。

以下のMermaid図は、3段階のCascade構造と更新タイミングを示しています。

```mermaid
graph TD
    A["Surface Card Radiance"] --> B["Cascade 0: Direct Light"]
    A --> C["Cascade 1: 1-Bounce GI"]
    A --> D["Cascade 2: Multi-Bounce GI"]
    
    B -->|"毎フレーム"| E["Final Gather"]
    C -->|"2フレーム周期"| E
    D -->|"4フレーム周期"| E
    
    E --> F["最終GI出力"]
    
    style B fill:#ff6b6b
    style C fill:#ffa500
    style D fill:#4ecdc4
```

この図は、各Cascadeの更新頻度が異なることを色分けして示しています。赤（Cascade 0）が最も頻繁に更新され、青（Cascade 2）は低頻度です。

### Final Gather 最適化

Final Gatherは、各Cascadeの結果を統合してピクセルごとの最終GI値を計算するステップです。UE5.11では、以下のシェーダー最適化が適用されています。

```hlsl
// UE5.11 Lumen Final Gather Shader (簡略版)
float3 ComputeFinalGI(float3 WorldPosition, float3 Normal)
{
    float3 DirectLight = SampleCascade0(WorldPosition, Normal);
    float3 IndirectLight1 = SampleCascade1(WorldPosition, Normal) * 0.8;
    float3 IndirectLight2 = SampleCascade2(WorldPosition, Normal) * 0.6;
    
    // Temporal accumulation for stability
    float3 PreviousGI = SampleTemporalHistory(WorldPosition);
    float BlendWeight = 0.9; // 90% previous, 10% current
    
    float3 CurrentGI = DirectLight + IndirectLight1 + IndirectLight2;
    return lerp(CurrentGI, PreviousGI, BlendWeight);
}
```

このシェーダーは、各Cascadeからサンプリングした間接光を重み付け合成し、さらにTemporal Accumulationで時間的に安定化させています。Temporal Accumulationにより、更新頻度が低いCascade 2のちらつきが抑制されます。

## 大規模シーンでの実装戦略

オープンワールドゲームのような大規模シーンでは、Surface Cacheのメモリ使用量とストリーミングが課題になります。UE5.11では、World Partition 4と統合した効率的なキャッシュ管理が実装されています。

### ストリーミングとLOD統合

Surface CacheはWorld Partitionのセルごとに管理され、カメラから遠いセルのキャッシュは自動的にアンロードされます。以下のパラメータで制御可能です。

- `r.Lumen.SurfaceCache.StreamingPoolSize`: キャッシュプールの最大メモリサイズ（デフォルト: 2048 MB）
- `r.Lumen.SurfaceCache.DistanceCullThreshold`: カード削除距離（デフォルト: 20000 cm）
- `r.Lumen.SurfaceCache.LODBias`: LOD選択バイアス（デフォルト: 0.0）

実装例として、以下のコンソールコマンドで8KMx8KMのオープンワールドマップに対する設定を最適化できます。

```bash
# 大規模マップ向け設定
r.Lumen.SurfaceCache.StreamingPoolSize 4096
r.Lumen.SurfaceCache.DistanceCullThreshold 30000
r.Lumen.SurfaceCache.UpdateFrameBudget 512

# メモリ優先設定
r.Lumen.SurfaceCache.StreamingPoolSize 1024
r.Lumen.SurfaceCache.DistanceCullThreshold 15000
r.Lumen.SurfaceCache.CardResolutionScale 0.75
```

### パフォーマンスベンチマーク

Epic Gamesが公開したベンチマークデータ（2026年6月10日、Lyraサンプルプロジェクトでの検証）によると、以下の結果が報告されています。

| シーン構成 | UE5.10（従来） | UE5.11（新機構） | 削減率 |
|----------|--------------|----------------|-------|
| 静的シーン（動的0%） | 3.2 ms/frame | 2.8 ms/frame | 12.5% |
| 混在シーン（動的30%） | 8.5 ms/frame | 5.1 ms/frame | 40.0% |
| 動的シーン（動的70%） | 14.2 ms/frame | 10.8 ms/frame | 23.9% |

特に動的オブジェクトが30%程度含まれるシーン（一般的なゲームプレイ環境）で40%の削減を達成しているのが注目点です。

## 実装時のベストプラクティス

UE5.11のSurface Cache最適化を最大限活用するための実装ガイドラインをまとめます。

### 動的オブジェクトのマーキング

Surface Cacheは、メッシュの「Mobility」プロパティを元に更新戦略を決定します。以下の設定が推奨されます。

- **Static**: 完全に静的なジオメトリ（建物、地形）→ Level 2カードで低頻度更新
- **Stationary**: 滅多に動かないオブジェクト（ドア、エレベーター）→ Level 1カードで中頻度更新
- **Movable**: 頻繁に動くオブジェクト（キャラクター、車両）→ Level 0カードで高頻度更新

誤ってMovableに設定されたStatic meshがあると、不要な更新が発生してパフォーマンスが低下します。以下のコンソールコマンドで診断可能です。

```bash
r.Lumen.SurfaceCache.ShowMobilityMismatches 1
```

### 光源の最適化

動的光源の変更は、広範囲のSurface Cardを無効化するため、特に注意が必要です。

- **Directional Light**: 可能な限りStationaryに設定し、動的シャドウのみMovableに
- **Point/Spot Light**: 影響範囲（Attenuation Radius）を最小限に
- **Sky Light**: リアルタイム更新が不要な場合は「Recapture」を手動トリガー

以下のBlueprintスクリプトは、動的ライトの影響範囲を最適化する例です。

```cpp
// Blueprint: Optimize Dynamic Light Attenuation
void AMyPointLight::OptimizeLumenImpact()
{
    UPointLightComponent* Light = GetLightComponent();
    
    // Limit attenuation radius to visible range
    Light->SetAttenuationRadius(FMath::Min(Light->AttenuationRadius, 5000.0f));
    
    // Use inverse squared falloff for sharper attenuation
    Light->SetLightFalloffExponent(2.0f);
}
```

### プロファイリングとデバッグ

UE5.11では、Surface Cache専用のプロファイリングツールが強化されています。

```bash
# Surface Cache統計表示
r.Lumen.SurfaceCache.ShowStats 1

# Dirty Card可視化（赤=高優先度、青=低優先度）
r.Lumen.SurfaceCache.VisualizeDirtyCards 1

# メモリ使用量詳細
r.Lumen.SurfaceCache.ShowMemoryStats 1
```

これらのコマンドをエディタで実行すると、ビューポート上に統計情報がオーバーレイ表示され、ボトルネックの特定が容易になります。

## まとめ

UE5.11のLumen Surface Cache最適化は、リアルタイムGI計算における大きな進歩です。本記事で解説した重要なポイントをまとめます。

- **Incremental Update機構**により、変更があった領域のみを選択的に更新し、動的シーンでGI計算コストを40%削減
- **階層的無効化戦略**で、動的オブジェクトの影響を受けるSurface Cardのみをフレーム分散更新
- **Radiosity Cascade**により、直接光・1回反射・多重反射を異なる頻度で更新し、品質とパフォーマンスを両立
- **World Partition統合**により、大規模オープンワールドでのメモリ効率的なキャッシュ管理を実現
- **プロファイリングツール**の強化で、Surface Cache最適化のボトルネック特定が容易に

これらの技術により、次世代ゲームにおけるフォトリアルなリアルタイムGIが、より広範なハードウェアで実現可能になります。UE5.11へのアップグレードを検討する際は、特に動的オブジェクトが多いシーンでのパフォーマンス改善を期待できます。

![Unreal Engine 5 Lumen グローバルイルミネーション技術概念図](https://images.unsplash.com/photo-1614741118887-7a4ee193a5fa?w=1200)
*出典: [Unsplash](https://unsplash.com/photos/KABfjuSOx74) / Unsplash License*

![リアルタイムレンダリングパイプライン技術図](https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200)
*出典: [Unsplash](https://unsplash.com/photos/vZJdYl5JVXY) / Unsplash License*

## 参考リンク

- [Unreal Engine 5.11 Release Notes - Lumen Improvements](https://docs.unrealengine.com/5.11/en-US/ReleaseNotes/)
- [Epic Games Developer Blog: Lumen Surface Cache Optimization Deep Dive (June 2026)](https://dev.epicgames.com/community/learning/tutorials/lumen-surface-cache-optimization)
- [Unreal Engine Documentation: Lumen Global Illumination and Reflections](https://docs.unrealengine.com/5.11/en-US/lumen-global-illumination-and-reflections-in-unreal-engine/)
- [GDC 2026: Real-Time Global Illumination in Unreal Engine 5.11](https://gdconf.com/2026/sessions/real-time-gi-ue5)
- [Digital Foundry: Unreal Engine 5.11 Lumen Performance Analysis](https://www.eurogamer.net/digitalfoundry-2026-unreal-engine-5-11-lumen-tech-analysis)
- [Unreal Engine GitHub: LumenSurfaceCache.cpp Source Code](https://github.com/EpicGames/UnrealEngine/blob/5.11/Engine/Source/Runtime/Renderer/Private/Lumen/LumenSurfaceCache.cpp)