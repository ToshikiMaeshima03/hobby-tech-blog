---
title: "UE5.9 Lumen Radiosity Cache アルゴリズム詳解｜動的ライト対応でグローバルイルミネーション品質維持"
description: "Unreal Engine 5.9で強化されたLumen Radiosity Cacheの内部実装を解説。動的ライト対応で実現する高品質リアルタイムGIの技術詳解と最適化手法を紹介します。"
category: "game-dev"
tags: ["Unreal Engine 5", "Lumen", "Radiosity Cache", "グローバルイルミネーション", "GPU最適化"]
publishedAt: 2026-05-17
featured: false
---

Unreal Engine 5.9は2026年4月にリリースされ、Lumenのグローバルイルミネーション（GI）システムに重要な改良が加えられました。特に**Radiosity Cache**の動的ライト対応により、可動光源を使用した場合でもリアルタイムGIの品質を維持できるようになったことは大きな進化です。本記事では、UE5.9のLumen Radiosity Cacheの内部アルゴリズムを詳細に解説し、動的ライトシーンでの実装戦略と最適化手法を紹介します。

従来のLumenでは、動的ライトを多用すると間接光の計算負荷が急増し、フレームレートが大幅に低下する問題がありました。UE5.9のRadiosity Cacheは、空間的・時間的なキャッシング戦略を組み合わせることで、動的ライトによる間接光の再計算を最小限に抑えながら、視覚的な品質を保つことを実現しています。

## Lumen Radiosity Cacheの基礎アーキテクチャ

Lumen Radiosity Cacheは、シーン内の間接光（放射輝度）を3D空間にキャッシュする仕組みです。これにより、毎フレーム全ピクセルで間接光を再計算する必要がなくなり、GPU負荷を大幅に削減します。

以下のダイアグラムは、Radiosity Cacheの基本的な処理フローを示しています。

```mermaid
flowchart TD
    A["シーン情報入力"] --> B["表面キャッシュ生成"]
    B --> C["プローブ配置判定"]
    C --> D["直接光照明計算"]
    D --> E["間接光伝播計算"]
    E --> F["Radiosity Cache更新"]
    F --> G["空間的補間"]
    G --> H["最終イメージ合成"]
    
    I["動的ライト変更検出"] --> J["影響範囲判定"]
    J --> K["部分的キャッシュ無効化"]
    K --> E
```

UE5.9のRadiosity Cacheは、以下の3層構造で実装されています。

1. **表面キャッシュ（Surface Cache）**: ジオメトリ表面に配置されたライティング情報
2. **ボリュメトリックプローブ（Volumetric Probes）**: 3D空間に配置された放射輝度サンプリングポイント
3. **階層的補間構造（Hierarchical Interpolation Structure）**: 効率的な空間クエリのための階層データ構造

### 表面キャッシュの実装詳細

表面キャッシュは、Naniteの仮想化ジオメトリと連携し、表面の物理的な解像度とは独立したライティング解像度を持ちます。UE5.9では、表面キャッシュの解像度を動的に調整する**適応的解像度制御**が導入されました。

```cpp
// 表面キャッシュの解像度計算（UE5.9の疑似コード）
float CalculateSurfaceCacheResolution(
    const FNaniteCluster& Cluster,
    const FViewInfo& View,
    float DynamicLightInfluence)
{
    // 画面空間での占有面積を計算
    float ScreenSpaceArea = CalculateScreenSpaceProjection(Cluster, View);
    
    // 動的ライトの影響度に応じて解像度を調整
    float ResolutionScale = 1.0f + DynamicLightInfluence * 0.5f;
    
    // 基本解像度: 1テクセル = 16cm²（デフォルト設定）
    float BaseTexelSize = 0.16f;
    
    return ScreenSpaceArea / (BaseTexelSize / ResolutionScale);
}
```

動的ライトが多い領域では解像度を自動的に増加させることで、間接光の品質低下を防ぎます。この適応的解像度制御により、静的なシーンと比較して約15〜20%のメモリオーバーヘッドで動的ライトをサポートできるようになりました。

## 動的ライト対応のRadiosity Cache更新戦略

UE5.9の最大の改良点は、動的ライトが移動・変更されたときのRadiosity Cache更新アルゴリズムです。従来のLumenでは、動的ライトが変更されると広範囲のキャッシュを無効化する必要がありましたが、UE5.9では**段階的更新（Incremental Update）**戦略を採用しています。

以下のダイアグラムは、動的ライト変更時のRadiosity Cache更新プロセスを示しています。

```mermaid
sequenceDiagram
    participant DL as 動的ライト
    participant DD as 差分検出システム
    participant RC as Radiosity Cache
    participant GP as GPUコンピュートシェーダー
    
    DL->>DD: ライト位置・強度変更
    DD->>DD: 前フレームとの差分計算
    DD->>RC: 影響範囲のプローブ特定
    RC->>RC: 影響度に応じた優先度設定
    
    loop フレーム予算内で処理
        RC->>GP: 高優先度プローブ更新リクエスト
        GP->>GP: 直接光・間接光再計算
        GP->>RC: 更新されたプローブデータ書き込み
    end
    
    RC->>DD: 未更新プローブを次フレームに繰り越し
```

このシーケンス図から分かるように、UE5.9のRadiosity Cacheは「すべてを即座に更新する」のではなく、「影響度の高い領域から段階的に更新する」方針を採用しています。

### 差分検出と影響範囲判定

動的ライトの変更を検出し、影響範囲を効率的に判定するために、UE5.9では**Temporal Difference Buffer**を使用します。

```cpp
// 動的ライト変更の差分計算（UE5.9の疑似コード）
struct FDynamicLightDelta
{
    FVector PositionDelta;     // 位置変化量
    float IntensityDelta;       // 強度変化量
    float ColorDelta;           // 色変化量
    float ShadowDelta;          // シャドウ変化量
};

FDynamicLightDelta CalculateLightDelta(
    const FLightSceneInfo& CurrentLight,
    const FLightSceneInfo& PreviousLight)
{
    FDynamicLightDelta Delta;
    
    Delta.PositionDelta = CurrentLight.Position - PreviousLight.Position;
    Delta.IntensityDelta = abs(CurrentLight.Intensity - PreviousLight.Intensity);
    Delta.ColorDelta = (CurrentLight.Color - PreviousLight.Color).Size();
    
    // シャドウマップの差分をビット単位で比較
    Delta.ShadowDelta = CompareShadowMaps(
        CurrentLight.ShadowMap,
        PreviousLight.ShadowMap);
    
    return Delta;
}

// 影響度スコアの計算
float CalculateInfluenceScore(const FDynamicLightDelta& Delta)
{
    // 各要素に重み付けして総合スコアを算出
    float Score = 
        Delta.PositionDelta.Size() * 0.3f +
        Delta.IntensityDelta * 0.4f +
        Delta.ColorDelta * 0.2f +
        Delta.ShadowDelta * 0.1f;
    
    return Score;
}
```

影響度スコアが閾値を超えたプローブのみを更新対象とすることで、GPU計算負荷を大幅に削減します。Epic Gamesの公式ドキュメントによれば、この手法により動的ライトシーンでのGPU負荷を平均35〜40%削減できるとされています。

## 階層的プローブ更新とフレーム予算管理

UE5.9のRadiosity Cacheは、限られたフレーム予算内で最大の視覚的効果を得るために、プローブを優先度順に更新する**階層的更新スケジューラ**を実装しています。

```mermaid
graph TD
    A["全プローブプール"] --> B{"カメラからの距離"}
    B -->|近い| C["優先度: 高"]
    B -->|中間| D["優先度: 中"]
    B -->|遠い| E["優先度: 低"]
    
    C --> F["毎フレーム更新"]
    D --> G["2〜4フレームごとに更新"]
    E --> H["4〜8フレームごとに更新"]
    
    F --> I["動的ライト影響判定"]
    G --> I
    H --> I
    
    I -->|影響あり| J["即時更新キューに追加"]
    I -->|影響なし| K["通常更新スケジュール"]
```

このダイアグラムは、プローブの更新優先度がカメラ距離と動的ライトの影響によって決定される仕組みを示しています。

### フレーム予算の動的割り当て

UE5.9では、フレームレートの目標値（例: 60fps = 16.67ms）に応じて、Radiosity Cache更新に割り当てる計算時間を動的に調整します。

```cpp
// フレーム予算管理（UE5.9の疑似コード）
class FRadiosityCacheBudgetManager
{
public:
    void UpdateFrameBudget(float FrameTime, float TargetFrameTime)
    {
        // フレームレートに余裕がある場合は予算を増やす
        if (FrameTime < TargetFrameTime * 0.8f)
        {
            CurrentBudget = FMath::Min(CurrentBudget * 1.1f, MaxBudget);
        }
        // フレームレートが厳しい場合は予算を減らす
        else if (FrameTime > TargetFrameTime * 0.95f)
        {
            CurrentBudget = FMath::Max(CurrentBudget * 0.9f, MinBudget);
        }
    }
    
    int32 CalculateProbeUpdateCount()
    {
        // 1プローブあたりの平均処理時間（実測値）
        float TimePerProbe = 0.02f; // 20マイクロ秒
        
        return static_cast<int32>(CurrentBudget / TimePerProbe);
    }
    
private:
    float CurrentBudget = 2.0f;  // デフォルト: 2ms
    float MaxBudget = 4.0f;      // 最大: 4ms
    float MinBudget = 1.0f;      // 最小: 1ms
};
```

この動的予算管理により、負荷の高いシーンでも安定したフレームレートを維持しながら、視覚的に最も重要な領域のGI品質を確保できます。

## 空間的補間とテンポラルフィルタリング

Radiosity Cacheから最終イメージを生成する際、UE5.9では**Spherical Harmonics（球面調和関数）ベースの空間補間**と**テンポラルアキュムレーション**を組み合わせています。

### Spherical Harmonics補間の実装

プローブ間の間接光を補間する際、UE5.9では2次のSpherical Harmonics（SH2）を使用します。これにより、方向性のある間接光を効率的に表現できます。

```cpp
// Spherical Harmonics補間（UE5.9の疑似コード）
struct FSHCoefficients
{
    FLinearColor L0;           // 定数項
    FLinearColor L1[3];        // 1次項（方向性）
    FLinearColor L2[5];        // 2次項（詳細な方向性）
};

FLinearColor InterpolateIndirectLighting(
    const FVector& WorldPosition,
    const FVector& Normal,
    const TArray<FRadiosityProbe>& NearbyProbes)
{
    FSHCoefficients InterpolatedSH = {};
    float TotalWeight = 0.0f;
    
    // 近傍プローブから重み付き補間
    for (const FRadiosityProbe& Probe : NearbyProbes)
    {
        float Distance = (Probe.Position - WorldPosition).Size();
        float Weight = CalculateProbeWeight(Distance, Normal, Probe.Normal);
        
        // SH係数を重み付き加算
        InterpolatedSH.L0 += Probe.SH.L0 * Weight;
        for (int i = 0; i < 3; i++)
            InterpolatedSH.L1[i] += Probe.SH.L1[i] * Weight;
        for (int i = 0; i < 5; i++)
            InterpolatedSH.L2[i] += Probe.SH.L2[i] * Weight;
        
        TotalWeight += Weight;
    }
    
    // 正規化
    InterpolatedSH /= TotalWeight;
    
    // 法線方向の放射輝度を評価
    return EvaluateSH(InterpolatedSH, Normal);
}
```

SH2を使用することで、1プローブあたり9個のRGB係数（計27個のfloat値）でリッチな方向性間接光を表現できます。UE5.8までのSH1（4係数）と比較して、視覚的な品質が大幅に向上しています。

### テンポラルアキュムレーション

動的ライトによるフリッカー（ちらつき）を抑制するため、UE5.9では複数フレームにわたってRadiosity Cacheの結果を蓄積する**テンポラルアキュムレーション**を実装しています。

```mermaid
stateDiagram-v2
    [*] --> 初期フレーム
    初期フレーム --> フルリライト計算: 動的ライト大幅変更
    初期フレーム --> 差分更新: 小規模変更
    
    差分更新 --> テンポラル混合: 前フレーム結果を再投影
    テンポラル混合 --> モーション検証: ジオメトリ移動検出
    
    モーション検証 --> 履歴保持: 静的ピクセル
    モーション検証 --> 履歴破棄: 移動・オクルージョン変化
    
    履歴保持 --> 安定フレーム: 8フレーム蓄積
    履歴破棄 --> 差分更新: 即座に再計算
    
    安定フレーム --> 差分更新: 次フレームへ
    フルリライト計算 --> 差分更新: 次フレームへ
```

この状態遷移図は、Radiosity Cacheのテンポラルアキュムレーションがどのように動作するかを示しています。

```cpp
// テンポラルアキュムレーション（UE5.9の疑似コード）
FLinearColor ApplyTemporalAccumulation(
    const FVector& WorldPosition,
    const FLinearColor& CurrentRadiosity,
    const FLinearColor& HistoryRadiosity,
    float MotionVector,
    int32 FramesSinceUpdate)
{
    // モーションベクトルが大きい場合は履歴を破棄
    if (MotionVector > 5.0f)
    {
        return CurrentRadiosity;
    }
    
    // 動的ライトの影響度に応じて混合比率を調整
    float BlendFactor = 0.95f; // デフォルトは前フレームを95%信頼
    
    // 更新頻度が低い場合は現在のフレームを重視
    if (FramesSinceUpdate > 4)
    {
        BlendFactor = 0.5f;
    }
    
    // 指数移動平均
    return FMath::Lerp(CurrentRadiosity, HistoryRadiosity, BlendFactor);
}
```

テンポラルアキュムレーションにより、動的ライトが移動しても視覚的にスムーズな間接光の遷移が実現されます。Epic Gamesのテストによれば、平均8フレームの蓄積で、動的ライトのフリッカーをほぼ完全に抑制できることが確認されています。

## パフォーマンス最適化の実践ガイド

UE5.9のRadiosity Cacheを実プロジェクトで使用する際の最適化テクニックを紹介します。

### プロジェクト設定の推奨値

動的ライトを多用するプロジェクトでは、以下の設定を調整することで品質とパフォーマンスのバランスを取ります。

```ini
; DefaultEngine.ini での推奨設定（UE5.9）

[/Script/Engine.RendererSettings]
; Radiosity Cache の基本設定
r.Lumen.RadiosityCache.Enable=1
r.Lumen.RadiosityCache.ProbeSpacing=200.0
r.Lumen.RadiosityCache.Resolution=512

; 動的ライト対応の最適化設定
r.Lumen.RadiosityCache.DynamicLightUpdate=1
r.Lumen.RadiosityCache.TemporalAccumulation=1
r.Lumen.RadiosityCache.MaxProbeUpdatesPerFrame=1024

; 品質設定（高品質プロジェクト向け）
r.Lumen.RadiosityCache.SHOrder=2
r.Lumen.RadiosityCache.AdaptiveResolution=1
r.Lumen.RadiosityCache.TemporalFrames=8

; メモリ最適化（メモリ制約がある場合）
r.Lumen.RadiosityCache.MaxCacheMemoryMB=512
r.Lumen.RadiosityCache.ProbeCullingDistance=5000.0
```

### 動的ライトの配置戦略

Radiosity Cacheの効率を最大化するため、動的ライトの配置には以下のガイドラインを適用します。

1. **移動頻度の分類**: 頻繁に移動するライト（プレイヤーの懐中電灯など）と、時々移動するライト（昼夜サイクルの太陽など）を分類
2. **影響範囲の制限**: 動的ライトのAttenuationRadiusを必要最小限に設定
3. **重要度タグの活用**: UE5.9の新機能「Light Importance Tag」で、視覚的に重要なライトを指定

```cpp
// ブループリント/C++でのライト重要度設定例
void ConfigureDynamicLight(UPointLightComponent* Light, bool bHighImportance)
{
    // UE5.9の新機能: ライト重要度タグ
    Light->LightImportance = bHighImportance ? 
        ELightImportance::Critical : 
        ELightImportance::Normal;
    
    // Radiosity Cache更新の優先度を設定
    Light->bAffectRadiosityCache = true;
    Light->RadiosityCacheUpdatePriority = bHighImportance ? 1.0f : 0.5f;
}
```

### GPUプロファイリングとボトルネック分析

Radiosity Cacheのパフォーマンスを監視するため、UE5.9では専用のプロファイリングコマンドが追加されました。

```
// UE5.9のコンソールコマンド

// Radiosity Cache統計を表示
stat LumenRadiosity

// 詳細なGPUタイミングを表示
stat GPU

// Radiosity Cacheの視覚化
r.Lumen.Visualize.RadiosityCache 1

// プローブ配置を視覚化
r.Lumen.Visualize.RadiosityProbes 1

// 動的ライトの影響範囲を視覚化
r.Lumen.Visualize.DynamicLightInfluence 1
```

![Unreal Engine 5のLumenビジュアライゼーションツール](https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=400&fit=crop)
*出典: [Unsplash](https://unsplash.com) / Unsplash License*

これらの視覚化ツールを使用することで、Radiosity Cacheの更新パターンやボトルネックを視覚的に把握できます。

## まとめ

UE5.9のLumen Radiosity Cacheは、動的ライト対応により次世代のリアルタイムGIを実現する重要な技術革新です。本記事で解説した主要なポイントをまとめます。

- **階層的キャッシング構造**: 表面キャッシュ・ボリュメトリックプローブ・階層的補間の3層構造で効率的な間接光計算を実現
- **段階的更新戦略**: 動的ライト変更時に影響範囲を限定し、優先度順に段階的にプローブを更新することでGPU負荷を35〜40%削減
- **適応的解像度制御**: 動的ライトの影響度に応じて表面キャッシュの解像度を動的調整し、メモリオーバーヘッドを15〜20%に抑制
- **Spherical Harmonics補間**: SH2を使用した方向性のある間接光表現により、視覚品質を大幅向上
- **テンポラルアキュムレーション**: 8フレームの蓄積により動的ライトによるフリッカーをほぼ完全に抑制
- **動的フレーム予算管理**: フレームレートに応じてRadiosity Cache更新の計算時間を自動調整し、安定した性能を維持

これらの技術により、UE5.9では可動光源を多用する動的なゲームシーンでも、高品質なリアルタイムグローバルイルミネーションが実用的なパフォーマンスで利用可能になりました。実プロジェクトでは、プロジェクト設定の最適化と動的ライト配置戦略を組み合わせることで、最大の視覚効果とパフォーマンスを引き出すことができます。

## 参考リンク

- [Unreal Engine 5.9 Release Notes - Epic Games](https://docs.unrealengine.com/5.9/en-US/unreal-engine-5.9-release-notes/)
- [Lumen Global Illumination and Reflections - Unreal Engine Documentation](https://docs.unrealengine.com/5.9/en-US/lumen-global-illumination-and-reflections-in-unreal-engine/)
- [Unreal Engine 5.9: What's New in Lumen - Epic Games Blog](https://www.unrealengine.com/en-US/blog/unreal-engine-5-9-whats-new-in-lumen)
- [Real-Time Global Illumination Techniques - SIGGRAPH 2026 Course Notes](https://www.siggraph.org/2026/courses/real-time-gi)
- [Performance Optimization for Lumen - Unreal Engine Community](https://forums.unrealengine.com/t/performance-optimization-for-lumen-in-ue5-9/2026)