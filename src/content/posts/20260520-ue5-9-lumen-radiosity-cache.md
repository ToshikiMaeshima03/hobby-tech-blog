---
title: "UE5.9 Lumen Radiosity Cache動的更新アルゴリズム｜グローバルイルミネーション品質メモリ両立実装"
description: "UE5.9のLumen Radiosity Cache動的更新メカニズムを技術的に解説。メモリ効率を保ちながら高品質なリアルタイムGIを実現する実装パターンとキャッシュ戦略を詳述。"
category: "game-dev"
tags: ["Unreal Engine 5", "Lumen", "グローバルイルミネーション", "GPU最適化", "リアルタイムレンダリング"]
publishedAt: 2026-05-21
featured: false
---

Unreal Engine 5.9（2026年4月リリース）で大幅に強化されたLumenのRadiosity Cache動的更新アルゴリズムは、従来のリアルタイムグローバルイルミネーション（GI）が抱えていた「品質とメモリのトレードオフ」問題を根本から解決する技術革新をもたらした。本記事では、UE5.9で新たに導入されたキャッシュ更新戦略の内部実装、メモリ管理の最適化パターン、そして実際のプロダクション環境での応用テクニックを技術的に詳解する。

従来のLumen実装では、動的ライトが多数存在するシーンでRadiosity Cacheのメモリ消費が急増し、VRAMが16GB以上のハイエンドGPUでも安定動作が困難なケースが報告されていた。UE5.9ではこの問題に対し、**時間的一貫性を考慮した段階的キャッシュ更新（Temporal Coherent Incremental Update）**と**優先度ベースのメモリ圧縮（Priority-Based Cache Compaction）**という2つの新アルゴリズムを導入している。

## Radiosity Cacheの基本アーキテクチャとUE5.9の改善点

Lumenのグローバルイルミネーションシステムは、シーン全体の間接光伝播をリアルタイムで計算するため、**Surface Cache**（表面ジオメトリの放射照度情報）と**Radiosity Cache**（間接光の多重反射結果）という2層のキャッシュ構造を採用している。

UE5.8以前のバージョンでは、動的ライトの移動や光源強度の変化が発生するたびに、影響範囲内の全Radiosity Cacheエントリを即座に再計算していた。これは品質面では理想的だが、大規模シーンでは以下の問題を引き起こしていた：

- **メモリフラグメンテーション**: キャッシュエントリの頻繁な割り当て・解放によりVRAMが断片化
- **帯域幅の浪費**: 変化の少ない領域まで毎フレーム再計算
- **GPU占有率の変動**: フレーム間で計算負荷が大きく変動し、フレームレートが不安定化

UE5.9では、**キャッシュエントリの有効期限（TTL: Time-To-Live）管理**と**段階的な更新優先度スケジューリング**を導入することで、これらの問題を解決している。

以下のダイアグラムは、UE5.9のRadiosity Cache更新パイプラインの全体フローを示している：

```mermaid
flowchart TD
    A["シーン変更検出"] --> B["キャッシュエントリの有効性評価"]
    B --> C{"優先度スコア計算"}
    C -->|高優先度| D["即時更新キュー"]
    C -->|中優先度| E["段階的更新キュー"]
    C -->|低優先度| F["遅延更新キュー"]
    D --> G["GPU Compute Shader実行"]
    E --> H["時間分割更新（4フレーム分散）"]
    F --> I["TTL延長＋補間"]
    G --> J["キャッシュ圧縮"]
    H --> J
    I --> J
    J --> K["統合Radiosity Cache"]
```

この図が示すように、UE5.9では単一の「全更新」パスではなく、優先度に基づく3段階のキュー管理によって、GPU負荷を平準化しながらも視覚的に重要な領域を優先的に更新する仕組みを実現している。

## 優先度ベースの動的更新アルゴリズム

UE5.9のRadiosity Cache動的更新システムの核心は、**視覚的影響度（Visual Impact Score）**に基づくキャッシュエントリの優先度付けにある。この優先度スコアは以下の4つの要素から計算される：

1. **カメラからの距離**: 近距離のキャッシュエントリほど高優先度
2. **光源変化の大きさ**: 光強度・位置の変化量が大きいほど高優先度
3. **前回更新からの経過時間**: 長時間更新されていないエントリは優先度上昇
4. **画面占有率**: 画面に映る面積が大きいほど高優先度

具体的な実装では、以下のような優先度計算式が使用されている（UE5.9のソースコード `LumenRadiosityCacheUpdate.cpp` より）：

```cpp
// UE5.9のRadiosity Cache優先度計算（簡略版）
float CalculateCachePriority(const FRadiosityCacheEntry& Entry, const FSceneView& View)
{
    // カメラ距離による減衰（近いほど高優先度）
    float DistanceFactor = 1.0f / FMath::Max(Entry.WorldPosition - View.ViewLocation).Size(), 100.0f);
    
    // 光源変化量（ライト強度・位置の差分）
    float LightChangeMagnitude = ComputeLightDelta(Entry.LastLightState, Entry.CurrentLightState);
    
    // 経過時間（最大10フレームまで線形増加）
    float TimeFactor = FMath::Min(Entry.FramesSinceLastUpdate / 10.0f, 1.0f);
    
    // 画面占有率（スクリーン投影面積）
    float ScreenCoverage = ComputeScreenSpaceCoverage(Entry, View);
    
    // 重み付き合成（調整可能なCVar）
    return (DistanceFactor * CVarLumenDistanceWeight.GetValueOnRenderThread() +
            LightChangeMagnitude * CVarLumenLightChangeWeight.GetValueOnRenderThread() +
            TimeFactor * CVarLumenTimeWeight.GetValueOnRenderThread() +
            ScreenCoverage * CVarLumenScreenCoverageWeight.GetValueOnRenderThread());
}
```

この優先度スコアに基づき、毎フレームの更新対象エントリが決定される。UE5.9では、**フレーム予算（Frame Budget）**という概念を導入し、1フレームあたりに更新可能な最大キャッシュエントリ数を動的に調整する機構も実装されている。

プロジェクト設定での調整例：

```ini
; Project Settings > Engine > Rendering > Lumen
[/Script/Engine.RendererSettings]
; 1フレームあたりの最大更新エントリ数（デフォルト512）
r.Lumen.RadiosityCache.MaxUpdatesPerFrame=512
; 優先度計算の重みパラメータ
r.Lumen.RadiosityCache.DistanceWeight=2.0
r.Lumen.RadiosityCache.LightChangeWeight=3.0
r.Lumen.RadiosityCache.TimeWeight=1.0
r.Lumen.RadiosityCache.ScreenCoverageWeight=2.5
```

## 時間的一貫性を考慮したキャッシュ補間戦略

UE5.9のもう一つの重要な改善点は、**Temporal Coherent Interpolation（時間的一貫性を持つ補間）**の実装である。従来のバージョンでは、キャッシュが更新されるまでの間、古いキャッシュデータがそのまま使用されていたため、動的ライトの移動時に「照明がカクカクと段階的に変化する」視覚的なアーティファクトが発生していた。

UE5.9では、**前フレームと現フレームのキャッシュデータを線形補間**することで、視覚的な滑らかさを維持しながら更新頻度を下げることに成功している。この補間処理は、以下のようなCompute Shaderで実装されている：

```hlsl
// LumenRadiosityInterpolation.usf（UE5.9新規追加）
[numthreads(8, 8, 1)]
void InterpolateRadiosityCacheCS(
    uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint CacheIndex = DispatchThreadId.x;
    if (CacheIndex >= NumCacheEntries) return;
    
    FRadiosityCacheEntry CurrentEntry = RadiosityCache[CacheIndex];
    FRadiosityCacheEntry PreviousEntry = PreviousFrameRadiosityCache[CacheIndex];
    
    // 光源変化が小さい場合は補間を適用
    if (CurrentEntry.UpdatePriority < LowPriorityThreshold)
    {
        // 指数移動平均による滑らかな遷移
        float Alpha = TemporalBlendFactor; // 通常0.1〜0.3
        CurrentEntry.Irradiance = lerp(PreviousEntry.Irradiance, 
                                       CurrentEntry.Irradiance, 
                                       Alpha);
        CurrentEntry.DirectionalAlbedo = lerp(PreviousEntry.DirectionalAlbedo,
                                               CurrentEntry.DirectionalAlbedo,
                                               Alpha);
    }
    
    RadiosityCache[CacheIndex] = CurrentEntry;
}
```

この補間メカニズムにより、以下の効果が得られる：

- **視覚的滑らかさの向上**: 光の変化が段階的ではなく連続的に見える
- **更新頻度の削減**: 低優先度エントリは実質的に4〜10フレームに1回の更新で済む
- **帯域幅の節約**: 補間処理のメモリアクセスは更新処理の約1/5

以下の状態遷移図は、キャッシュエントリのライフサイクルを示している：

```mermaid
stateDiagram-v2
    [*] --> Allocated: 新規エントリ作成
    Allocated --> HighPriority: 優先度評価（高）
    Allocated --> MediumPriority: 優先度評価（中）
    Allocated --> LowPriority: 優先度評価（低）
    
    HighPriority --> Updating: 即時更新開始
    MediumPriority --> Queued: 段階的更新キュー
    LowPriority --> Interpolating: 補間適用
    
    Updating --> Updated: 更新完了
    Queued --> Updating: キュー処理
    Interpolating --> Updated: 補間完了
    
    Updated --> HighPriority: 次フレーム評価
    Updated --> MediumPriority: 次フレーム評価
    Updated --> LowPriority: 次フレーム評価
    Updated --> Expired: TTL期限切れ
    
    Expired --> [*]: メモリ解放
```

## メモリ圧縮とキャッシュ圧縮アルゴリズム

UE5.9で導入された**Priority-Based Cache Compaction（優先度ベースのキャッシュ圧縮）**は、VRAMの断片化問題を解決するための重要な機構である。従来のバージョンでは、キャッシュエントリの追加・削除が頻繁に行われることで、VRAMが「虫食い状態」になり、実効的な利用可能メモリが減少していた。

UE5.9では、以下の2段階の圧縮戦略を採用している：

### 1. インクリメンタル圧縮（Incremental Compaction）

毎フレーム、優先度の低い領域から順に少しずつメモリを再配置し、連続した空き領域を確保する。この処理は**非同期Compute Queue**で実行されるため、レンダリングパイプラインへの影響が最小限に抑えられている。

```cpp
// LumenRadiosityCacheCompaction.cpp（UE5.9新規実装）
void FLumenRadiosityCache::IncrementalCompaction(FRHICommandListImmediate& RHICmdList)
{
    // 低優先度エントリから順にソート
    TArray<uint32> CompactionCandidates;
    for (uint32 i = 0; i < CacheEntries.Num(); ++i)
    {
        if (CacheEntries[i].Priority < CompactionPriorityThreshold)
        {
            CompactionCandidates.Add(i);
        }
    }
    
    // 優先度順にソート（低いものから）
    CompactionCandidates.Sort([this](uint32 A, uint32 B) {
        return CacheEntries[A].Priority < CacheEntries[B].Priority;
    });
    
    // 1フレームあたり最大64エントリを再配置
    uint32 MaxCompactionsPerFrame = 64;
    for (uint32 i = 0; i < FMath::Min(CompactionCandidates.Num(), MaxCompactionsPerFrame); ++i)
    {
        RelocateCacheEntry(CompactionCandidates[i]);
    }
}
```

### 2. フルコンパクション（Full Compaction）

シーンの大幅な変更（レベルストリーミング、カットシーン遷移など）が検出された場合、非同期タスクとして**フルコンパクション**を実行する。この処理では、全キャッシュエントリをメモリ上で連続配置し直し、断片化を完全に解消する。

実装例（Blueprint公開APIとしても利用可能）：

```cpp
// C++ APIでの手動トリガー例
void AMyGameMode::OnLevelTransition()
{
    if (UWorld* World = GetWorld())
    {
        if (FSceneInterface* Scene = World->Scene)
        {
            // フルコンパクションを非同期実行
            Scene->GetLumenSceneData()->RequestFullCacheCompaction();
        }
    }
}
```

以下のガントチャートは、通常フレームとコンパクション実行フレームでのGPUタイムラインの違いを示している：

```mermaid
gantt
    title GPUタイムライン比較（16.6ms/60fps）
    dateFormat X
    axisFormat %L
    
    section 通常フレーム
    Shadow Maps           :a1, 0, 3
    GBuffer               :a2, 3, 5
    Lumen Cache Update    :a3, 8, 3
    Post Process          :a4, 11, 4
    
    section コンパクション実行フレーム
    Shadow Maps           :b1, 0, 3
    GBuffer               :b2, 3, 5
    Lumen Cache Update    :b3, 8, 2
    Incremental Compact   :b4, 10, 1
    Post Process          :b5, 11, 4
```

この図が示すように、インクリメンタル圧縮は**1ms以下の追加コスト**で実行され、60fpsのフレームレート維持に影響を与えない設計となっている。

## 実践的な最適化パターンとパフォーマンステクニック

UE5.9のRadiosity Cache動的更新を最大限活用するための実践的な最適化パターンを以下に示す。

### パターン1: 動的ライトの優先度グルーピング

シーン内の動的ライトを**視覚的重要度**に応じて3つのグループに分類し、それぞれ異なる更新頻度を設定する：

```cpp
// LightComponentの拡張設定（C++）
UCLASS()
class UMyLightComponent : public UPointLightComponent
{
    GENERATED_BODY()
    
    UPROPERTY(EditAnywhere, Category="Lumen")
    ELumenLightPriority CachePriority = ELumenLightPriority::Medium;
};

enum class ELumenLightPriority : uint8
{
    Critical,  // 毎フレーム更新（プレイヤー周辺、主要光源）
    Medium,    // 4フレームに1回（中距離、補助光源）
    Low        // 10フレームに1回（遠距離、環境光）
};
```

プロジェクト設定での一括調整：

```ini
[/Script/Engine.RendererSettings]
; 各優先度レベルの更新間隔（フレーム数）
r.Lumen.RadiosityCache.CriticalLightUpdateInterval=1
r.Lumen.RadiosityCache.MediumLightUpdateInterval=4
r.Lumen.RadiosityCache.LowLightUpdateInterval=10
```

### パターン2: 空間的局所性を利用したキャッシュプリフェッチ

プレイヤーの移動方向を予測し、進行方向のキャッシュエントリを事前に高優先度に設定する：

```cpp
// プレイヤー移動予測によるキャッシュウォームアップ
void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 移動ベクトルから予測位置を計算（2秒先）
    FVector PredictedLocation = GetActorLocation() + GetVelocity() * 2.0f;
    
    // Lumenシステムに予測位置を通知
    if (UWorld* World = GetWorld())
    {
        if (FSceneInterface* Scene = World->Scene)
        {
            Scene->GetLumenSceneData()->AddCachePrefetchLocation(PredictedLocation, 1000.0f);
        }
    }
}
```

### パターン3: メモリ予算の動的調整

ターゲットプラットフォームのVRAM容量に応じて、キャッシュサイズを動的に調整する：

```cpp
// プラットフォーム別のメモリ設定（DefaultEngine.ini）
[/Script/Engine.RendererSettings]
; ハイエンドPC（VRAM 16GB以上）
r.Lumen.RadiosityCache.MaxMemoryMB=2048

[PlatformSettings_Console]
; コンソール（VRAM 10GB程度）
r.Lumen.RadiosityCache.MaxMemoryMB=1024

[PlatformSettings_Mobile]
; モバイル（VRAM 4GB以下）
r.Lumen.RadiosityCache.MaxMemoryMB=256
```

以下のシーケンス図は、キャッシュメモリが上限に達した際の自動調整フローを示している：

```mermaid
sequenceDiagram
    participant Game as ゲームスレッド
    participant Lumen as Lumenシステム
    participant GPU as GPU
    
    Game->>Lumen: 新規キャッシュ割り当て要求
    Lumen->>Lumen: 現在のメモリ使用量確認
    alt メモリ使用率 < 90%
        Lumen->>GPU: キャッシュエントリ割り当て
        GPU-->>Lumen: 割り当て成功
        Lumen-->>Game: キャッシュID返却
    else メモリ使用率 >= 90%
        Lumen->>Lumen: 低優先度エントリ検索
        Lumen->>GPU: 低優先度エントリ解放
        GPU-->>Lumen: 解放完了
        Lumen->>GPU: 新規エントリ割り当て
        GPU-->>Lumen: 割り当て成功
        Lumen-->>Game: キャッシュID返却（遅延あり）
    end
```

## パフォーマンスベンチマークと実測データ

Epic Gamesが公開したUE5.9のパフォーマンステストデータ（2026年4月、GDC 2026セッション資料より）によれば、以下の改善が確認されている：

**テスト環境**:
- GPU: NVIDIA RTX 5080（VRAM 16GB）
- 解像度: 4K（3840×2160）
- シーン: 大規模オープンワールド（Lumina City Demo、動的ライト100個）

**結果比較**:

| 指標 | UE5.8 | UE5.9 | 改善率 |
|------|-------|-------|--------|
| 平均フレームレート | 48 fps | 62 fps | +29% |
| Lumen GPU時間 | 8.2 ms | 5.7 ms | -30% |
| VRAM使用量（Lumenキャッシュ） | 2.8 GB | 1.9 GB | -32% |
| キャッシュミス率 | 12.3% | 4.1% | -67% |
| フレーム時間の標準偏差 | 3.2 ms | 1.1 ms | -66%（安定性向上） |

特に注目すべきは、**フレーム時間の標準偏差が大幅に減少**している点である。これは、動的更新の平準化によって「重いフレーム」と「軽いフレーム」の差が縮小し、体感的な滑らかさが向上したことを意味する。

## まとめ

UE5.9のLumen Radiosity Cache動的更新アルゴリズムは、以下の技術革新によってリアルタイムGIの実用性を大幅に向上させた：

- **優先度ベースの段階的更新**: 視覚的重要度に基づくインテリジェントなキャッシュ管理により、GPU負荷を30%削減
- **時間的一貫性を持つ補間**: 低優先度エントリへの補間適用により、更新頻度を下げながら視覚品質を維持
- **メモリ圧縮機構**: インクリメンタル圧縮とフルコンパクションの組み合わせで、VRAMの断片化を解消し、メモリ使用量を32%削減
- **動的フレーム予算管理**: プラットフォーム特性に応じた自動調整により、多様なハードウェアで安定動作

これらの改善により、UE5.9では16GB VRAMのミドルレンジGPUでも、100個以上の動的ライトを含む大規模シーンで60fps以上の安定動作が可能になっている。今後のゲーム開発において、Lumenは「ハイエンド専用の実験的機能」から「実用的な標準GI技術」へと進化したと言えるだろう。

実装時の推奨事項として、プロジェクト初期段階から**ライトの優先度設計**と**メモリ予算の見積もり**を行い、ターゲットプラットフォームに応じた最適化パラメータを設定することが重要である。

## 参考リンク

- [Unreal Engine 5.9 Release Notes - Lumen Improvements](https://docs.unrealengine.com/5.9/en-US/unreal-engine-5.9-release-notes/)
- [Epic Games GDC 2026: Lumen Radiosity Cache Optimization Deep Dive](https://www.unrealengine.com/en-US/events/gdc-2026)
- [Lumen Technical Guide - Radiosity Cache Architecture](https://docs.unrealengine.com/5.9/en-US/lumen-global-illumination-and-reflections-in-unreal-engine/)
- [NVIDIA RTX 50 Series Performance Analysis with UE5.9 Lumen](https://developer.nvidia.com/blog/ue59-lumen-rtx50-performance/)
- [Real-Time Global Illumination Techniques in Modern Game Engines (2026)](https://www.gdcvault.com/play/1035892/Real-Time-Global-Illumination-Techniques)