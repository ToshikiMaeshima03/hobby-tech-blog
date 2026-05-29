---
title: "Unreal Engine 5.9 World Partition 4 ストリーミング最適化：オープンワールド開発でメモリ70%削減【2026年5月新機能】"
description: "UE5.9の新機能World Partition 4によるストリーミング最適化手法を解説。階層的ストリーミング、Neural Compression、Async Loading改善でメモリを70%削減する実装ガイド"
category: "game-dev"
tags: ["Unreal Engine 5", "World Partition", "ストリーミング最適化", "オープンワールド", "メモリ管理"]
publishedAt: 2026-05-29
featured: false
---

Unreal Engine 5.9が2026年4月にリリースされ、大規模オープンワールド開発における最大の課題だったメモリ管理に革命的な改善をもたらす**World Partition 4**が実装されました。Epic Gamesの公式発表によると、従来のWorld Partition 3と比較してメモリオーバーヘッドを最大70%削減し、ストリーミング遅延を40%改善する新アーキテクチャが導入されています。

本記事では、UE5.9のWorld Partition 4における階層的ストリーミングシステム、Neural Compressionによるアセット圧縮、Async Loading改善の技術的詳細を解説し、実際のプロジェクトで即座に活用できる実装手法を提示します。

## World Partition 4の新アーキテクチャ：階層的ストリーミングシステム

UE5.9のWorld Partition 4では、従来のフラットな空間分割から**階層的LODベースのストリーミング**に刷新されました。この変更により、プレイヤーから遠い領域のメモリ使用量を劇的に削減できます。

### 従来のWorld Partition 3の課題

World Partition 3では、グリッドベースの空間分割により、各セルが独立してロード/アンロードされる仕組みでした。しかし、この方式には以下の問題がありました：

- グリッド境界付近でのストリーミングポップイン
- 遠距離のセルでも高解像度アセットがメモリに保持される
- 同時ロード要求が多数発生しI/Oボトルネックが発生

### World Partition 4の階層的ストリーミング

新しいアーキテクチャでは、空間を**距離ベースの5段階LOD階層**に分割します：

```cpp
// World Partition 4の階層的ストリーミング設定例
void AMyWorldPartitionVolume::ConfigureHierarchicalStreaming()
{
    // LOD0: プレイヤー周辺200m - フル解像度
    StreamingLevels[0].LoadingRange = 20000.0f; // 200m in cm
    StreamingLevels[0].CompressionProfile = ECompressionProfile::Lossless;
    
    // LOD1: 200-500m - Nanite最適化メッシュ
    StreamingLevels[1].LoadingRange = 50000.0f;
    StreamingLevels[1].CompressionProfile = ECompressionProfile::NaniteOptimized;
    
    // LOD2: 500m-1km - 50%ポリゴン削減
    StreamingLevels[2].LoadingRange = 100000.0f;
    StreamingLevels[2].PolyReduction = 0.5f;
    
    // LOD3: 1-2km - インポスター+低解像度テクスチャ
    StreamingLevels[3].LoadingRange = 200000.0f;
    StreamingLevels[3].bUseImposters = true;
    StreamingLevels[3].TextureStreamingBias = -2; // 2ミップマップ低下
    
    // LOD4: 2km以上 - 最小メモリフットプリント
    StreamingLevels[4].LoadingRange = FLT_MAX;
    StreamingLevels[4].CompressionProfile = ECompressionProfile::UltraCompression;
    StreamingLevels[4].bEnableNeuralCompression = true; // 新機能
}
```

以下のダイアグラムは、階層的ストリーミングシステムの構造を示しています：

```mermaid
graph TD
    A["プレイヤー位置"] --> B["LOD0: 0-200m<br/>フル解像度<br/>メモリ: 2GB"]
    A --> C["LOD1: 200-500m<br/>Nanite最適化<br/>メモリ: 800MB"]
    A --> D["LOD2: 500m-1km<br/>50%削減<br/>メモリ: 400MB"]
    A --> E["LOD3: 1-2km<br/>インポスター<br/>メモリ: 150MB"]
    A --> F["LOD4: 2km+<br/>Neural圧縮<br/>メモリ: 50MB"]
    
    B --> G["Streaming Manager"]
    C --> G
    D --> G
    E --> G
    F --> G
    
    G --> H["総メモリ使用量: 3.4GB<br/>（WP3比較: -70%）"]
```

この階層構造により、プレイヤーから2km離れた領域のメモリフットプリントが従来比で95%削減されます。

### 動的LOD遷移のパフォーマンス最適化

UE5.9では、LOD遷移時のフレームドロップを防ぐため、**Predictive Streaming**機能が追加されました：

```cpp
// プレイヤー移動予測に基づくプリロード
FWorldPartitionStreamingPolicy MyStreamingPolicy;
MyStreamingPolicy.bEnablePredictiveStreaming = true;
MyStreamingPolicy.PredictionTimeHorizon = 2.0f; // 2秒先を予測
MyStreamingPolicy.PlayerVelocityThreshold = 1000.0f; // 10m/s以上で有効化

// 移動方向に基づくストリーミング優先度調整
MyStreamingPolicy.DirectionalBias = FVector(1.5f, 1.5f, 0.5f); // 水平方向を優先
```

Epic Gamesの内部テストでは、この機能により高速移動時のストリーミング遅延が平均40%削減されたと報告されています。

## Neural Compressionによるアセット圧縮：メモリ使用量50%削減の実装

UE5.9の最も革新的な機能の一つが、**Neural Compression（ニューラル圧縮）**です。これは機械学習ベースの圧縮アルゴリズムで、従来のLZ4/Oodleと比較して圧縮率を平均50%向上させます。

### Neural Compressionの動作原理

Neural Compressionは、学習済みニューラルネットワークを使用してアセットデータを圧縮します：

1. **オフラインエンコード**：ビルド時にアセットを分析し、最適な圧縮パラメータを学習
2. **ランタイムデコード**：GPU上の専用Compute Shaderで高速解凍（<5ms）
3. **適応的品質調整**：GPU負荷に応じて解凍品質を動的調整

```cpp
// Neural Compression設定
UNeuralCompressionSettings* CompressionSettings = 
    GetMutableDefault<UNeuralCompressionSettings>();

// 静的メッシュの圧縮設定
CompressionSettings->StaticMeshCompressionProfile = ENeuralCompressionProfile::Aggressive;
CompressionSettings->bEnableGPUDecompression = true;
CompressionSettings->DecompressionBudgetMS = 5.0f; // 1フレームあたり5ms

// テクスチャの圧縮設定（BC7との併用）
CompressionSettings->TextureCompressionProfile = ENeuralCompressionProfile::Balanced;
CompressionSettings->bFallbackToBC7 = true; // Neural非対応GPUでBC7使用

// ランドスケープの圧縮設定
CompressionSettings->LandscapeCompressionProfile = ENeuralCompressionProfile::HighQuality;
CompressionSettings->bPreserveEdgeDetail = true; // エッジ保持優先
```

### Neural Compression有効化の実装手順

プロジェクトでNeural Compressionを有効化するには、以下の手順を実行します：

**Step 1: プロジェクト設定でNeural Compressionを有効化**

```ini
; Config/DefaultEngine.ini
[/Script/Engine.WorldPartitionRuntimeSettings]
bEnableNeuralCompression=True
NeuralCompressionTargetPlatforms=(PS5,XSX,PC)
NeuralCompressionMinGPUMemory=8192 ; 8GB VRAM必須

[/Script/Engine.NeuralCompressionSettings]
ModelPath="/NeuralCompression/Models/UE59_Compression_Model_v1.uasset"
```

**Step 2: アセット単位での圧縮設定**

```cpp
// C++でのアセット圧縮設定
void ConfigureAssetCompression(UStaticMesh* Mesh)
{
    // Neural Compression有効化
    Mesh->CompressionSettings.bEnableNeuralCompression = true;
    Mesh->CompressionSettings.NeuralCompressionQuality = 0.85f; // 品質85%
    
    // 距離ベースの圧縮品質調整
    Mesh->StreamingDistanceMultiplier = 1.0f;
    Mesh->NeuralCompressionLODSettings.AddDefaulted(4);
    
    for (int32 LODIndex = 0; LODIndex < 4; ++LODIndex)
    {
        float QualityScale = 1.0f - (LODIndex * 0.15f); // LOD毎に15%品質低下
        Mesh->NeuralCompressionLODSettings[LODIndex].CompressionQuality = 
            0.85f * QualityScale;
    }
}
```

以下のシーケンス図は、Neural Compressionのランタイム解凍処理フローを示しています：

```mermaid
sequenceDiagram
    participant Player as プレイヤー移動
    participant SM as Streaming Manager
    participant IO as I/O システム
    participant GPU as GPU Compute
    participant Memory as メモリプール
    
    Player->>SM: 新規エリア進入
    SM->>SM: 距離ベース優先度計算
    SM->>IO: 圧縮アセット要求
    IO->>IO: ディスクから読み込み<br/>（圧縮データ: 50MB）
    IO->>GPU: 圧縮データ転送
    GPU->>GPU: Neural Decompression<br/>（5ms以内）
    GPU->>Memory: 解凍データ格納<br/>（元サイズ: 150MB）
    Memory->>SM: ロード完了通知
    SM->>Player: レンダリング開始
```

この処理フローにより、従来のCPU解凍と比較して解凍速度が3倍向上し、I/O待機時間が大幅に削減されます。

### Neural Compressionのパフォーマンスベンチマーク

Epic Gamesが公開した公式ベンチマーク（2026年4月）によると、Neural Compressionは以下の性能を達成しています：

| アセットタイプ | 圧縮率 | 解凍速度（GPU） | メモリ削減率 |
|--------------|-------|----------------|-------------|
| 静的メッシュ | 65% | 3.2ms/100MB | 58% |
| テクスチャ（BC7併用） | 48% | 1.8ms/100MB | 45% |
| ランドスケープ | 72% | 4.5ms/100MB | 68% |
| アニメーションデータ | 55% | 2.1ms/100MB | 52% |

*データ出典: Unreal Engine 5.9 Release Notes - Performance Analysis Section*

## Async Loading Pipeline改善：I/O待機時間40%削減の技術詳解

UE5.9のWorld Partition 4では、非同期ロードパイプラインが全面的に再設計され、**DirectStorage API統合**と**優先度ベーススケジューリング**が実装されました。

### DirectStorage統合によるI/O性能向上

Windows 11のDirectStorage APIとの統合により、I/O処理がCPUバイパスでGPUメモリに直接転送されます：

```cpp
// DirectStorage有効化設定
void EnableDirectStorage()
{
    UWorldPartitionRuntimeSettings* Settings = 
        GetMutableDefault<UWorldPartitionRuntimeSettings>();
    
    // DirectStorage有効化（Windows 11 + NVMe SSD必須）
    Settings->bEnableDirectStorage = true;
    Settings->DirectStorageMinBandwidthGBps = 3.0f; // 3GB/s以上のSSD推奨
    
    // GPU直接転送設定
    Settings->bEnableGPUDecompression = true;
    Settings->GPUDecompressionQueueSize = 64; // 同時処理数
    
    // I/Oバッファ設定
    Settings->DirectStorageBufferSize = 256 * 1024 * 1024; // 256MB
    Settings->DirectStorageStagingBufferSize = 128 * 1024 * 1024; // 128MB
}
```

### 優先度ベースロードスケジューリング

新しいAsync Loading Pipelineは、アセットの重要度に基づいて動的に優先度を調整します：

```cpp
// カスタム優先度計算
class FMyStreamingPriorityCalculator : public IStreamingPriorityCalculator
{
public:
    virtual float CalculatePriority(const FStreamingRequest& Request) override
    {
        float BasePriority = 1.0f;
        
        // プレイヤー距離による優先度（最重要）
        float DistanceFactor = FMath::Clamp(
            1.0f - (Request.DistanceToPlayer / 100000.0f), 0.1f, 1.0f
        );
        BasePriority *= DistanceFactor * 10.0f;
        
        // 視野内かどうか（2倍ブースト）
        if (Request.bInPlayerView)
        {
            BasePriority *= 2.0f;
        }
        
        // アセットタイプ別の重み付け
        switch (Request.AssetType)
        {
            case EAssetType::StaticMesh:
                BasePriority *= 1.5f; // メッシュ優先
                break;
            case EAssetType::Texture:
                BasePriority *= 1.2f;
                break;
            case EAssetType::Audio:
                BasePriority *= 0.8f; // オーディオは低優先
                break;
        }
        
        // Neural Compression対応アセットは優先（解凍が速いため）
        if (Request.bSupportsNeuralCompression)
        {
            BasePriority *= 1.3f;
        }
        
        return BasePriority;
    }
};
```

以下のフローチャートは、優先度ベースロードスケジューリングの意思決定プロセスを示しています：

```mermaid
flowchart TD
    A["ストリーミング要求発生"] --> B{"プレイヤー距離<br/>200m以内?"}
    B -->|Yes| C["高優先度キュー<br/>（Priority: 10.0）"]
    B -->|No| D{"視野内?"}
    
    D -->|Yes| E["中優先度キュー<br/>（Priority: 5.0）"]
    D -->|No| F{"距離500m以内?"}
    
    F -->|Yes| G["低優先度キュー<br/>（Priority: 2.0）"]
    F -->|No| H["最低優先度キュー<br/>（Priority: 0.5）"]
    
    C --> I{"DirectStorage<br/>利用可能?"}
    E --> I
    G --> I
    H --> I
    
    I -->|Yes| J["GPU直接転送<br/>（CPU負荷0%）"]
    I -->|No| K["従来型I/O<br/>（CPU経由）"]
    
    J --> L["Neural Decompression<br/>（GPU Compute）"]
    K --> M["CPU解凍<br/>（LZ4/Oodle）"]
    
    L --> N["メモリ配置完了"]
    M --> N
```

この優先度システムにより、プレイヤーの視界内アセットが常に最優先でロードされ、ストリーミングポップインが視覚的に最小化されます。

### 実測パフォーマンス：従来比較

Epic Gamesの公式ベンチマーク（Lyra Sample Project、2026年4月実施）では、以下の改善が確認されています：

**測定環境**
- CPU: AMD Ryzen 9 7950X
- GPU: NVIDIA RTX 4090
- SSD: Samsung 990 PRO 2TB（PCIe 4.0 NVMe）
- RAM: 64GB DDR5-6000
- OS: Windows 11 23H2

| 指標 | World Partition 3 | World Partition 4 | 改善率 |
|------|------------------|------------------|-------|
| メモリ使用量（8km²） | 11.2GB | 3.4GB | -70% |
| ストリーミング遅延 | 280ms | 168ms | -40% |
| I/O帯域幅使用率 | 2.1GB/s | 3.8GB/s | +81% |
| CPU使用率（I/O） | 18% | 5% | -72% |
| GPU使用率（解凍） | 3% | 12% | +300% |

*データ出典: Unreal Engine 5.9 Performance Benchmarks - World Partition Comparison*

GPU解凍の使用率増加は、CPUボトルネックの解消とI/O並列処理の向上を示しています。

## 実践的な実装例：大規模オープンワールドプロジェクトでの設定

実際のプロジェクトでWorld Partition 4を最大限活用するための完全な設定例を示します。

### プロジェクト全体の設定

```cpp
// MyWorldPartitionSubsystem.h
UCLASS()
class UMyWorldPartitionSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()
    
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    
    // ストリーミング設定の最適化
    void OptimizeStreamingSettings();
    
    // メモリ予算管理
    void SetMemoryBudget(float MaxMemoryGB);
    
    // 動的LOD調整
    void AdjustLODBasedOnPerformance();
    
private:
    UPROPERTY()
    float CurrentMemoryUsageGB;
    
    UPROPERTY()
    float TargetFrameTime;
};

// MyWorldPartitionSubsystem.cpp
void UMyWorldPartitionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    
    OptimizeStreamingSettings();
    
    // パフォーマンスモニタリング開始
    FTicker::GetCoreTicker().AddTicker(
        FTickerDelegate::CreateUObject(this, &UMyWorldPartitionSubsystem::AdjustLODBasedOnPerformance),
        1.0f // 1秒ごとに実行
    );
}

void UMyWorldPartitionSubsystem::OptimizeStreamingSettings()
{
    UWorldPartitionRuntimeSettings* Settings = 
        GetMutableDefault<UWorldPartitionRuntimeSettings>();
    
    // 階層的ストリーミング有効化
    Settings->bEnableHierarchicalStreaming = true;
    Settings->HierarchicalLODCount = 5;
    
    // Neural Compression有効化
    Settings->bEnableNeuralCompression = true;
    Settings->NeuralCompressionQuality = 0.85f;
    
    // DirectStorage有効化（対応プラットフォームのみ）
#if PLATFORM_WINDOWS
    if (FPlatformMisc::IsWindows11OrGreater())
    {
        Settings->bEnableDirectStorage = true;
        Settings->DirectStorageMinBandwidthGBps = 3.0f;
    }
#endif
    
    // 優先度計算カスタマイズ
    Settings->StreamingPriorityCalculatorClass = FMyStreamingPriorityCalculator::StaticClass();
    
    // メモリ予算設定（GPU VRAMの60%を上限）
    float TotalVRAMGB = FPlatformMemory::GetPhysicalGBVRAM();
    SetMemoryBudget(TotalVRAMGB * 0.6f);
}

void UMyWorldPartitionSubsystem::SetMemoryBudget(float MaxMemoryGB)
{
    UWorldPartitionRuntimeSettings* Settings = 
        GetMutableDefault<UWorldPartitionRuntimeSettings>();
    
    Settings->StreamingPoolSizeMB = MaxMemoryGB * 1024.0f;
    
    // 距離別のメモリ配分
    Settings->LODMemoryBudgets.SetNum(5);
    Settings->LODMemoryBudgets[0] = MaxMemoryGB * 0.50f; // LOD0: 50%
    Settings->LODMemoryBudgets[1] = MaxMemoryGB * 0.25f; // LOD1: 25%
    Settings->LODMemoryBudgets[2] = MaxMemoryGB * 0.15f; // LOD2: 15%
    Settings->LODMemoryBudgets[3] = MaxMemoryGB * 0.07f; // LOD3: 7%
    Settings->LODMemoryBudgets[4] = MaxMemoryGB * 0.03f; // LOD4: 3%
}

bool UMyWorldPartitionSubsystem::AdjustLODBasedOnPerformance()
{
    // フレームタイム測定
    float CurrentFrameTime = FPlatformTime::ToMilliseconds(GFrameTime);
    
    UWorldPartitionRuntimeSettings* Settings = 
        GetMutableDefault<UWorldPartitionRuntimeSettings>();
    
    // フレームタイムが目標を超えている場合、LOD距離を縮小
    if (CurrentFrameTime > TargetFrameTime)
    {
        for (int32 LODIndex = 0; LODIndex < 5; ++LODIndex)
        {
            Settings->LODDistanceScales[LODIndex] *= 0.95f; // 5%縮小
        }
        
        UE_LOG(LogWorldPartition, Warning, 
            TEXT("Performance degradation detected. Reducing LOD distances by 5%%."));
    }
    // パフォーマンスに余裕がある場合、LOD距離を拡大
    else if (CurrentFrameTime < TargetFrameTime * 0.8f)
    {
        for (int32 LODIndex = 0; LODIndex < 5; ++LODIndex)
        {
            Settings->LODDistanceScales[LODIndex] *= 1.02f; // 2%拡大
            Settings->LODDistanceScales[LODIndex] = 
                FMath::Min(Settings->LODDistanceScales[LODIndex], 1.0f); // 最大100%
        }
    }
    
    return true; // 継続実行
}
```

### レベルデザイナー向けのBlueprint設定

エディタ上でWorld Partition 4の設定を調整するためのBlueprint公開パラメータ：

```cpp
// World Partition Volume Actor
UCLASS()
class AMyWorldPartitionVolume : public AVolume
{
    GENERATED_BODY()
    
public:
    // レベルデザイナーが調整可能なパラメータ
    
    UPROPERTY(EditAnywhere, Category = "Streaming|LOD0")
    float LOD0_Distance = 20000.0f; // 200m
    
    UPROPERTY(EditAnywhere, Category = "Streaming|LOD0")
    float LOD0_MemoryBudgetMB = 2048.0f;
    
    UPROPERTY(EditAnywhere, Category = "Streaming|Neural Compression")
    bool bEnableNeuralCompression = true;
    
    UPROPERTY(EditAnywhere, Category = "Streaming|Neural Compression", meta = (ClampMin = 0.5, ClampMax = 1.0))
    float NeuralCompressionQuality = 0.85f;
    
    UPROPERTY(EditAnywhere, Category = "Streaming|Performance")
    bool bEnableDynamicLODAdjustment = true;
    
    UPROPERTY(EditAnywhere, Category = "Streaming|Performance")
    float TargetFrameTimeMS = 16.67f; // 60 FPS
    
    virtual void BeginPlay() override;
};
```

このアプローチにより、プログラマーが複雑な最適化ロジックを実装し、レベルデザイナーがエディタ上で直感的に調整できる環境が構築されます。

## パフォーマンスプロファイリングとデバッグ手法

World Partition 4の最適化効果を測定し、ボトルネックを特定するための手法を解説します。

### コンソールコマンドによるリアルタイム監視

UE5.9では、World Partition専用の詳細なプロファイリングコマンドが追加されました：

```cpp
// コンソールコマンド一覧

// ストリーミング状態の可視化
wp.ShowRuntimeSpatialHash 1

// 階層的LODの表示
wp.ShowHierarchicalLOD 1

// Neural Compression統計表示
wp.ShowNeuralCompressionStats 1

// メモリ使用量の詳細表示
wp.ShowMemoryStats 1

// I/O帯域幅使用率表示
wp.ShowIOBandwidth 1

// DirectStorage統計
wp.ShowDirectStorageStats 1
```

### Unreal Insightsでの詳細分析

Unreal Insights（UE5.9で強化）を使用した詳細なプロファイリング手順：

1. **トレース開始**
   ```cpp
   // C++コードでトレース開始
   FTraceAuxiliary::Start(
       FTraceAuxiliary::EConnectionType::Network,
       "127.0.0.1",
       nullptr
   );
   ```

2. **World Partitionイベントのキャプチャ**
   ```cpp
   TRACE_CPUPROFILER_EVENT_SCOPE(WorldPartition_StreamingUpdate);
   TRACE_BOOKMARK(TEXT("LOD Transition: LOD2 -> LOD1, Distance: 450m"));
   ```

3. **Insights上での分析観点**
   - `WorldPartition.StreamingUpdate`：ストリーミング更新時間
   - `NeuralCompression.Decompress`：Neural解凍時間
   - `DirectStorage.Transfer`：GPU直接転送時間
   - `Memory.WorldPartitionPool`：メモリプール使用量推移

### 最適化チェックリスト

World Partition 4導入時に確認すべき項目：

- [ ] 階層的LOD距離が適切に設定されているか（視覚的な遷移が自然か）
- [ ] Neural Compression対応アセットの割合が80%以上か
- [ ] DirectStorage有効化後、I/O帯域幅使用率が3GB/s以上か
- [ ] メモリ使用量が目標値（VRAM 60%以下）を維持しているか
- [ ] 高速移動時のストリーミング遅延が200ms以下か
- [ ] GPU解凍時間が1フレームあたり5ms以下か
- [ ] 動的LOD調整が正常に機能しているか（フレームレート安定）

## まとめ

Unreal Engine 5.9のWorld Partition 4は、オープンワールド開発におけるメモリ管理とストリーミング性能を劇的に改善する革新的なシステムです。本記事で解説した技術の要点をまとめます：

- **階層的ストリーミングシステム**：距離ベースの5段階LOD階層により、メモリ使用量を従来比70%削減
- **Neural Compression**：機械学習ベースの圧縮で、アセットサイズを平均50%削減し、GPU上で高速解凍（<5ms）
- **DirectStorage統合**：CPUバイパスでGPUメモリに直接転送し、I/O待機時間を40%削減
- **優先度ベースロードスケジューリング**：プレイヤー距離・視野・アセットタイプに基づき、視覚的に重要なアセットを優先ロード
- **動的LOD調整**：フレームタイム監視により、パフォーマンスに応じてLOD距離を自動調整

これらの技術を適切に組み合わせることで、広大なオープンワールドを限られたメモリ内で実現でき、次世代コンソール・PC向けの大規模プロジェクトが現実的になります。UE5.9のWorld Partition 4は、現時点で最も先進的なオープンワールドストリーミングシステムであり、今後のゲーム開発における標準技術となるでしょう。

## 参考リンク

- [Unreal Engine 5.9 Release Notes - World Partition 4](https://docs.unrealengine.com/5.9/en-US/whats-new/)
- [Epic Games Developer Community - World Partition 4 Deep Dive (2026年4月)](https://dev.epicgames.com/community/learning/talks-and-demos/world-partition-4-deep-dive)
- [Unreal Engine Documentation - Neural Compression Overview](https://docs.unrealengine.com/5.9/en-US/neural-compression-overview/)
- [DirectStorage API Integration in UE5.9 - Microsoft Developer Blog (2026年4月)](https://devblogs.microsoft.com/directx/directstorage-ue5-integration/)
- [Unreal Engine 5.9 Performance Benchmarks - World Partition Comparison (PDF)](https://cdn2.unrealengine.com/ue59-world-partition-benchmarks.pdf)