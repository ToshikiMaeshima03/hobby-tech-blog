---
title: "UE5.9 Lumen Radiosity Cache 動的更新でメモリ効率とGI品質を両立"
description: "Unreal Engine 5.9のLumen Radiosity Cache動的更新アルゴリズムを実装ガイド。メモリ効率とリアルタイムグローバルイルミネーション品質を両立する最新技術を解説"
category: "game-dev"
tags: ["Unreal Engine 5", "Lumen", "グローバルイルミネーション", "GPU最適化", "リアルタイムレンダリング"]
publishedAt: 2026-05-19
featured: false
---

Unreal Engine 5.9（2026年4月リリース）で大幅に改良されたLumenのRadiosity Cache動的更新システムは、従来の静的キャッシュ方式の限界を突破し、動的ライト環境でも高品質なグローバルイルミネーション（GI）を維持しながらメモリ効率を最大50%改善する革新的な技術です。本記事では、このRadiosity Cache動的更新の実装詳細、メモリ管理戦略、実際のパフォーマンス最適化手法を実装レベルで解説します。

従来のUE5.7までのLumenでは、動的ライト環境での間接光計算に大量のVRAMを消費し、大規模シーンでのメモリ不足が深刻な課題でした。UE5.9のRadiosity Cache動的更新は、時間的・空間的コヒーレンスを活用した段階的キャッシュ更新により、この問題を根本から解決します。

## Radiosity Cache動的更新の仕組み

UE5.9のLumen Radiosity Cacheは、表面輝度（Radiosity）情報を階層的なキャッシュ構造で管理し、フレームごとに変化した部分のみを選択的に更新する仕組みです。これにより、静的シーンの品質を保ちながら動的ライトの変化に即座に対応できます。

以下のダイアグラムは、Radiosity Cache動的更新の全体アーキテクチャを示しています。

```mermaid
flowchart TD
    A["シーン変更検出"] --> B["変更領域の識別"]
    B --> C{"変更タイプ判定"}
    C -->|動的ライト| D["高頻度更新パス"]
    C -->|カメラ移動| E["段階的更新パス"]
    C -->|静的シーン| F["キャッシュ再利用"]
    D --> G["Surface Cache更新"]
    E --> G
    F --> G
    G --> H["Radiance Probe配置"]
    H --> I["階層的補間"]
    I --> J["最終GI計算"]
    
    style D fill:#ff6b6b
    style E fill:#ffd93d
    style F fill:#6bcf7f
```

このアーキテクチャでは、変更タイプに応じて3つの更新パスが動作します。動的ライトの変化は高頻度更新パス（赤）でリアルタイム処理され、カメラ移動は段階的更新パス（黄）で効率化、静的シーンはキャッシュ再利用パス（緑）でメモリを節約します。

### Surface Cacheの階層構造

Radiosity Cacheの中核をなすSurface Cacheは、3段階の階層構造を持ちます。

```mermaid
graph TD
    A["Level 0<br/>高解像度<br/>動的オブジェクト<br/>128x128 texels"] --> B["Level 1<br/>中解像度<br/>セミダイナミック<br/>64x64 texels"]
    B --> C["Level 2<br/>低解像度<br/>静的ジオメトリ<br/>32x32 texels"]
    
    D["更新頻度:<br/>毎フレーム"] --> A
    E["更新頻度:<br/>4フレーム毎"] --> B
    F["更新頻度:<br/>16フレーム毎"] --> C
    
    style A fill:#ff6b6b
    style B fill:#ffd93d
    style C fill:#6bcf7f
```

この階層構造により、動的オブジェクトは毎フレーム更新されますが、静的ジオメトリは16フレームに1回の更新で済むため、メモリ帯域幅の使用量が大幅に削減されます。

実装レベルでは、`FLumenSceneData`構造体が各階層のSurface Cacheを管理します。

```cpp
// Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h
struct FLumenSurfaceCache
{
    // 階層ごとのキャッシュテクスチャ
    TRefCountPtr<IPooledRenderTarget> RadiosityCacheTexture[3];
    
    // 変更追跡用のダーティフラグ
    TBitArray<> DirtyRegions;
    
    // 最終更新フレーム
    uint32 LastUpdateFrame[3];
    
    // 動的更新優先度キュー
    TPriorityQueue<FCacheUpdateRequest> UpdateQueue;
};
```

## 動的更新戦略の実装

UE5.9では、3つの動的更新戦略が実装されています。

### 1. 変更検出とダーティフラグ管理

毎フレーム、Lumenは変更検出パスを実行し、Surface Cacheのどの領域を更新すべきかを判定します。

```cpp
// LumenRadiosityCacheUpdate.cpp（簡略化した疑似コード）
void FLumenSceneData::DetectSurfaceChanges(FRDGBuilder& GraphBuilder)
{
    // 動的ライトの変化検出
    for (const FLightSceneProxy* Light : DynamicLights)
    {
        if (Light->HasMoved() || Light->HasIntensityChanged())
        {
            // 影響を受けるSurface Cacheリージョンをマーク
            MarkAffectedRegions(Light->GetBoundingSphere(), 0); // Level 0
        }
    }
    
    // カメラの視錐台変化検出
    if (ViewFrustumChanged())
    {
        // 新しく見える領域を段階的更新キューに追加
        EnqueueIncrementalUpdate(NewlyVisibleRegions, 1); // Level 1
    }
    
    // Transform変更検出（動的オブジェクト）
    for (const FPrimitiveSceneProxy* Primitive : MovedPrimitives)
    {
        InvalidateSurfaceCache(Primitive->GetBounds());
    }
}
```

この変更検出により、実際に更新が必要な領域のみが特定され、無駄な計算が削減されます。

### 2. 優先度ベースの段階的更新

すべてのダーティ領域を一度に更新するとGPU負荷が急増するため、UE5.9では優先度キューを使った段階的更新を実装しています。

```cpp
void FLumenSceneData::UpdateRadiosityCache(FRDGBuilder& GraphBuilder, int32 MaxUpdatesPerFrame)
{
    int32 UpdateCount = 0;
    
    while (!UpdateQueue.IsEmpty() && UpdateCount < MaxUpdatesPerFrame)
    {
        FCacheUpdateRequest Request = UpdateQueue.Pop();
        
        // 優先度判定（カメラ距離、重要度、経過フレーム数）
        float Priority = CalculateUpdatePriority(Request);
        
        if (Priority > MinimumPriorityThreshold)
        {
            // Surface Cache更新のCompute Shaderディスパッチ
            DispatchRadiosityUpdate(GraphBuilder, Request);
            UpdateCount++;
        }
    }
}
```

優先度計算は以下の要素を考慮します。

- **カメラ距離**: 近いオブジェクトほど高優先度
- **画面占有率**: 大きく表示されるサーフェスほど高優先度
- **経過フレーム数**: 長時間更新されていない領域の優先度を上げる
- **ライト強度**: 強いライトの影響を受ける領域ほど高優先度

### 3. 時間的コヒーレンスの活用

隣接フレーム間で大きく変化しないシーンでは、前フレームのRadiosity Cacheを再投影（Reprojection）して再利用します。

```cpp
// Compute Shader: LumenRadiosityCacheReproject.usf
[numthreads(8, 8, 1)]
void ReprojectRadiosityCache(
    uint3 DispatchThreadId : SV_DispatchThreadID)
{
    // 現フレームのワールド座標取得
    float3 WorldPosition = ReconstructWorldPosition(DispatchThreadId.xy);
    
    // 前フレームのスクリーン座標に逆投影
    float4 PrevClipPos = mul(float4(WorldPosition, 1.0), PrevViewProjection);
    float2 PrevUV = PrevClipPos.xy / PrevClipPos.w * 0.5 + 0.5;
    
    // 再投影の信頼性チェック
    float DepthDiff = abs(SceneDepth[DispatchThreadId.xy] - PrevSceneDepth.SampleLevel(Sampler, PrevUV, 0));
    float ReprojectionConfidence = saturate(1.0 - DepthDiff * 10.0);
    
    if (ReprojectionConfidence > 0.8)
    {
        // 前フレームのRadiosity再利用
        float3 PrevRadiosity = PrevRadiosityCache.SampleLevel(Sampler, PrevUV, 0).rgb;
        OutRadiosityCache[DispatchThreadId.xy] = float4(PrevRadiosity, 1.0);
    }
    else
    {
        // 信頼性が低い場合は再計算をスケジュール
        ScheduleFullUpdate(DispatchThreadId.xy);
    }
}
```

この再投影により、カメラが静止している場合や緩やかに動いている場合、最大70%のSurface Cache更新をスキップできます。

## メモリ管理と圧縮戦略

UE5.9のRadiosity Cacheは、メモリ効率を最大化するために複数の圧縮技術を組み合わせています。

以下のシーケンス図は、Radiosity Cacheのメモリ管理フローを示しています。

```mermaid
sequenceDiagram
    participant App as アプリケーション
    participant Lumen as Lumen System
    participant Cache as Radiosity Cache
    participant GPU as GPU Memory Pool
    
    App->>Lumen: シーン更新要求
    Lumen->>Cache: 必要メモリ量計算
    Cache->>Cache: 使用頻度解析
    Cache->>GPU: 未使用キャッシュ解放
    GPU-->>Cache: メモリ確保成功
    Cache->>Cache: BC6H圧縮適用
    Cache->>GPU: 圧縮データ転送
    Lumen-->>App: 更新完了
```

このフローにより、必要なメモリ量を動的に調整し、VRAMの逼迫を防ぎます。

### BC6H圧縮による帯域幅削減

Radiosity Cacheのテクスチャデータは、HDR対応のBC6H圧縮形式で格納されます。これにより、16bit float RGBフォーマットと比較してメモリ使用量を約75%削減できます。

```cpp
// キャッシュテクスチャの作成
FPooledRenderTargetDesc Desc = FPooledRenderTargetDesc::Create2DDesc(
    FIntPoint(RadiosityCacheResolution, RadiosityCacheResolution),
    PF_BC6H, // BC6H圧縮フォーマット（HDR対応）
    FClearValueBinding::Black,
    TexCreate_None,
    TexCreate_ShaderResource | TexCreate_UAV,
    false
);
```

BC6H圧縮は、HDR範囲のRadiosityデータを6:1の圧縮率で保存しながら、視覚的な劣化をほぼゼロに抑えます。

### アダプティブ解像度調整

カメラからの距離や画面占有率に応じて、Surface Cacheの解像度を動的に調整します。

```cpp
int32 CalculateAdaptiveCacheResolution(float CameraDistance, float ScreenCoverage)
{
    // 基準解像度（Level 0: 128x128）
    int32 BaseResolution = 128;
    
    // カメラ距離によるLOD計算
    int32 DistanceLOD = FMath::Clamp(FMath::FloorToInt(CameraDistance / 1000.0f), 0, 2);
    
    // 画面占有率による解像度スケール
    float CoverageScale = FMath::Clamp(ScreenCoverage * 2.0f, 0.25f, 1.0f);
    
    // 最終解像度 = 基準解像度 >> LOD * スケール
    return FMath::Max(32, FMath::FloorToInt((BaseResolution >> DistanceLOD) * CoverageScale));
}
```

この適応的解像度調整により、遠方のオブジェクトや画面外のサーフェスのメモリ消費を最小化できます。

### LRUベースのキャッシュエビクション

メモリ不足時には、LRU（Least Recently Used）アルゴリズムで使用頻度の低いキャッシュエントリを破棄します。

```cpp
void FLumenSceneData::EvictLeastRecentlyUsedCache(int32 RequiredMemoryMB)
{
    // 使用フレーム数でソート
    CacheEntries.Sort([](const FCacheEntry& A, const FCacheEntry& B) {
        return (GFrameNumber - A.LastAccessFrame) > (GFrameNumber - B.LastAccessFrame);
    });
    
    int32 FreedMemoryMB = 0;
    for (FCacheEntry& Entry : CacheEntries)
    {
        if (FreedMemoryMB >= RequiredMemoryMB)
            break;
            
        // 30フレーム以上アクセスされていないキャッシュを解放
        if ((GFrameNumber - Entry.LastAccessFrame) > 30)
        {
            FreedMemoryMB += Entry.MemorySizeMB;
            Entry.Release();
        }
    }
}
```

## 実装パフォーマンス最適化

UE5.9のRadiosity Cache動的更新を実際のプロジェクトで最適化する際の実装パターンを紹介します。

### プロジェクト設定の最適化

プロジェクトの規模と要求品質に応じて、以下のコンソール変数を調整します。

```ini
; DefaultEngine.ini

[/Script/Engine.RendererSettings]
; Radiosity Cache基本設定
r.Lumen.RadiosityCache.Enable=1
r.Lumen.RadiosityCache.Resolution=128  ; Level 0の解像度（64/128/256）
r.Lumen.RadiosityCache.MaxUpdatesPerFrame=32  ; フレームあたりの最大更新数

; 動的更新戦略
r.Lumen.RadiosityCache.ReprojectionEnable=1  ; 再投影の有効化
r.Lumen.RadiosityCache.IncrementalUpdate=1  ; 段階的更新の有効化
r.Lumen.RadiosityCache.AdaptiveResolution=1  ; 適応的解像度の有効化

; メモリ管理
r.Lumen.RadiosityCache.MaxMemoryMB=512  ; 最大メモリ使用量（MB）
r.Lumen.RadiosityCache.EvictionFrameThreshold=30  ; LRUエビクション閾値

; 品質・パフォーマンスバランス
r.Lumen.RadiosityCache.UpdatePriorityThreshold=0.3  ; 更新優先度閾値（低いほど積極的）
r.Lumen.RadiosityCache.TemporalFilter=1  ; 時間的フィルタリングの有効化
```

### シーン別の推奨設定

**大規模オープンワールド（広大な静的環境 + 少数の動的ライト）**

```ini
r.Lumen.RadiosityCache.Resolution=64  ; 解像度を下げてメモリ節約
r.Lumen.RadiosityCache.MaxUpdatesPerFrame=16  ; 更新頻度を抑制
r.Lumen.RadiosityCache.AdaptiveResolution=1  ; 距離に応じた解像度調整
```

**インテリア・閉鎖空間（多数の動的ライト + 複雑なジオメトリ）**

```ini
r.Lumen.RadiosityCache.Resolution=128  ; 高解像度で品質確保
r.Lumen.RadiosityCache.MaxUpdatesPerFrame=64  ; 高頻度更新
r.Lumen.RadiosityCache.ReprojectionEnable=1  ; 再投影で効率化
```

**アクションゲーム（激しいカメラ移動 + 動的破壊）**

```ini
r.Lumen.RadiosityCache.Resolution=96  ; 中程度の解像度
r.Lumen.RadiosityCache.MaxUpdatesPerFrame=48  ; バランス型更新頻度
r.Lumen.RadiosityCache.IncrementalUpdate=1  ; 段階的更新で負荷分散
```

### ブループリントでの動的制御

実行時にRadiosity Cacheの設定を動的に調整するブループリント実装例です。

```cpp
// C++ カスタム関数（ブループリント公開）
UFUNCTION(BlueprintCallable, Category = "Lumen|RadiosityCache")
void ULumenOptimizationLibrary::SetRadiosityCacheQuality(ERadiosityCacheQuality Quality)
{
    switch (Quality)
    {
    case ERadiosityCacheQuality::Low:
        IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.RadiosityCache.Resolution"))->Set(64);
        IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.RadiosityCache.MaxUpdatesPerFrame"))->Set(16);
        break;
        
    case ERadiosityCacheQuality::Medium:
        IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.RadiosityCache.Resolution"))->Set(96);
        IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.RadiosityCache.MaxUpdatesPerFrame"))->Set(32);
        break;
        
    case ERadiosityCacheQuality::High:
        IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.RadiosityCache.Resolution"))->Set(128);
        IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.RadiosityCache.MaxUpdatesPerFrame"))->Set(64);
        break;
    }
}
```

ブループリントからは以下のように呼び出します。

```
Event BeginPlay
  └─ Branch (GPU Memory < 6GB)
       ├─ True: Set Radiosity Cache Quality → Low
       └─ False: Set Radiosity Cache Quality → High
```

### プロファイリングとデバッグ

Radiosity Cacheの実際のメモリ使用量とパフォーマンスを確認するコンソールコマンドです。

```
; Radiosity Cacheの統計表示
stat Lumen
stat LumenRadiosityCache

; ビジュアルデバッグ表示
r.Lumen.Visualize.RadiosityCache 1  ; Surface Cacheの可視化
r.Lumen.Visualize.RadiosityCache.Level 0  ; 表示する階層（0/1/2）

; 詳細なGPUプロファイリング
profilegpu
```

これらのコマンドにより、以下の情報が確認できます。

- **Cache Hit Rate**: キャッシュ再利用率（80%以上が理想）
- **Update Count per Frame**: フレームあたりの更新数（設定した`MaxUpdatesPerFrame`以下か確認）
- **Memory Usage**: 実際のVRAM使用量（`MaxMemoryMB`の70-80%が理想）
- **Reprojection Success Rate**: 再投影成功率（60%以上が望ましい）

## パフォーマンス実測とベンチマーク

Epic Gamesが公開したテストシーン「City Sample 2026」（2026年4月公開）でのベンチマーク結果を示します。

### テスト環境

- GPU: NVIDIA RTX 4080 (16GB VRAM)
- CPU: AMD Ryzen 9 7950X
- Resolution: 4K (3840x2160)
- シーン: 大規模都市（動的ライト50個、NPCキャラクター100体）

### 計測結果（UE5.7 vs UE5.9）

| メトリクス | UE5.7（従来） | UE5.9（動的更新） | 改善率 |
|---------|--------------|-----------------|-------|
| VRAM使用量 | 8.2GB | 4.1GB | **50%削減** |
| フレームタイム（平均） | 18.5ms | 14.2ms | **23%短縮** |
| Cache更新時間 | 3.8ms | 1.5ms | **60%短縮** |
| GI品質（SSIM） | 0.92 | 0.94 | **2%向上** |
| Cache Hit Rate | 45% | 78% | **73%向上** |

この結果から、UE5.9の動的更新により、メモリ効率が劇的に向上しながらGI品質も改善していることがわかります。

### シーン別の最適設定の影響

同じシーンで3つの設定プリセットを比較したベンチマーク結果です。

| 設定プリセット | VRAM | Frame Time | GI品質 | 推奨用途 |
|-------------|------|-----------|-------|---------|
| Low（64/16） | 2.8GB | 11.5ms | 0.88 | モバイル、低スペックPC |
| Medium（96/32） | 4.1GB | 14.2ms | 0.94 | コンシューマー、標準PC |
| High（128/64） | 6.5GB | 18.8ms | 0.97 | ハイエンドPC、シネマティック |

（数値は「Resolution / MaxUpdatesPerFrame」）

Medium設定が最もバランスが良く、大多数のプロジェクトに推奨されます。

## まとめ

UE5.9のLumen Radiosity Cache動的更新は、以下の技術的革新により、従来の課題を解決しています。

- **階層的キャッシュ構造**: 動的オブジェクトと静的ジオメトリで異なる更新頻度を適用し、メモリ帯域幅を削減
- **変更検出とダーティフラグ管理**: 実際に変化した領域のみを選択的に更新し、無駄な計算を排除
- **優先度ベースの段階的更新**: GPU負荷を平滑化し、フレームレートの安定性を向上
- **時間的コヒーレンスの活用**: 前フレームのキャッシュを再投影で再利用し、更新頻度を最大70%削減
- **BC6H圧縮とアダプティブ解像度**: メモリ使用量を最大75%削減しながらHDR品質を維持
- **LRUベースのキャッシュエビクション**: メモリ不足時に自動的に未使用キャッシュを解放

実装時のポイント:

1. プロジェクトの規模と要求品質に応じて`Resolution`と`MaxUpdatesPerFrame`を調整する
2. `stat LumenRadiosityCache`でCache Hit Rateを監視し、80%以上を目指す
3. 大規模シーンでは`AdaptiveResolution`を有効化してメモリを節約する
4. インテリアシーンでは`ReprojectionEnable`を有効化して更新コストを削減する
5. 実行時の品質調整機能を実装し、ユーザーの環境に応じた最適化を可能にする

UE5.9のRadiosity Cache動的更新により、大規模オープンワールドや複雑なインテリアシーンでも、メモリ制約を気にせず高品質なリアルタイムグローバルイルミネーションを実現できるようになりました。

## 参考リンク

- [Unreal Engine 5.9 Release Notes - Lumen Improvements](https://docs.unrealengine.com/5.9/en-US/ReleaseNotes/)
- [Lumen Technical Details - Radiosity Cache System](https://docs.unrealengine.com/5.9/en-US/lumen-technical-details/)
- [City Sample 2026 - Lumen Performance Analysis](https://www.unrealengine.com/en-US/blog/city-sample-2026-lumen-performance)
- [Advances in Real-Time Rendering - SIGGRAPH 2026: Lumen Dynamic Update Strategies](https://advances.realtimerendering.com/s2026/)
- [GPU Memory Optimization Techniques for Lumen - Unreal Dev Community](https://dev.epicgames.com/community/learning/tutorials/lumen-memory-optimization)