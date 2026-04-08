---
title: "Unity マルチスレッド物理演算の最適化完全ガイド｜Job System & DOTS 2026"
description: "Unity Job SystemとDOTS/ECSを使った物理演算の並列処理最適化手法を実装例付きで解説。CPU性能を5〜50倍改善する具体的なコード例と設定方法を紹介"
category: "game-dev"
tags: ["Unity", "最適化", "物理演算", "マルチスレッド"]
publishedAt: 2026-04-08
featured: false
---

## なぜUnityの物理演算はボトルネックになるのか

Unityの標準物理演算（PhysX）はメインスレッドで実行されるため、大量のオブジェクトを扱うゲームではフレームレートが低下します。300体のエージェントでUpdate()を使った物理処理を実行すると約18ms掛かるのに対し、Job Systemを使えば0.47msまで短縮可能というベンチマークもあります。

本記事では、**Unity Job System**と**DOTS（Data-Oriented Technology Stack）**を使った物理演算のマルチスレッド化手法を、実装可能なコード例とともに解説します。2026年の最新Unity 6.2環境に対応した内容です。

## Unity Job Systemによる基本的なマルチスレッド化

### Job Systemの基本構造

Unity Job Systemは、複数のCPUコアを使って並列処理を実現する仕組みです。以下は基本的なIJobの実装例です。

```csharp
using Unity.Jobs;
using Unity.Collections;
using UnityEngine;

public struct VelocityJob : IJob
{
    public NativeArray<Vector3> velocities;
    public float deltaTime;

    public void Execute()
    {
        for (int i = 0; i < velocities.Length; i++)
        {
            velocities[i] += new Vector3(0, -9.81f, 0) * deltaTime;
        }
    }
}

public class PhysicsJobExample : MonoBehaviour
{
    private NativeArray<Vector3> velocities;
    private JobHandle jobHandle;

    void Start()
    {
        velocities = new NativeArray<Vector3>(1000, Allocator.Persistent);
    }

    void Update()
    {
        VelocityJob job = new VelocityJob
        {
            velocities = velocities,
            deltaTime = Time.deltaTime
        };

        jobHandle = job.Schedule();
    }

    void LateUpdate()
    {
        jobHandle.Complete();
        // velocitiesを使った処理
    }

    void OnDestroy()
    {
        velocities.Dispose();
    }
}
```

### IJobParallelForによる並列処理

単一のJobでは処理を1つのスレッドで実行しますが、IJobParallelForを使えばバッチ処理が複数コアに分散されます。

```csharp
using Unity.Jobs;
using Unity.Collections;
using Unity.Burst;
using UnityEngine;

[BurstCompile]
public struct ParallelVelocityJob : IJobParallelFor
{
    public NativeArray<Vector3> positions;
    public NativeArray<Vector3> velocities;
    public float deltaTime;

    public void Execute(int index)
    {
        velocities[index] += new Vector3(0, -9.81f, 0) * deltaTime;
        positions[index] += velocities[index] * deltaTime;
    }
}
```

**[BurstCompile]属性**を付けることで、IL2CPPよりも高速なネイティブコードに最適化されます。Burst Compilerはバッテリー消費も削減するため、モバイルゲームでは必須です。

## PhysXの設定最適化でフレームレートを改善する

Job Systemを導入する前に、Unity標準の物理演算設定を見直すだけでもパフォーマンスが向上します。

### Physics Settingsの最適化項目

**Edit → Project Settings → Physics** で以下を調整します。

```plaintext
Auto Simulation: false
  → 毎フレーム自動実行を無効化し、必要なタイミングで手動実行

Auto Sync Transforms: false
  → Transform変更を即座に物理エンジンに反映しない

Reuse Collision Callbacks: true
  → 衝突コールバックのメモリを再利用

Broad Phase Type: Automatic Box Pruning
  → 衝突判定の粗いフェーズを高速化

Friction Type: Two Directional
  → 摩擦計算を軽量化（One Directionalも検討）

Fixed Timestep: 0.02 (50fps) → 0.025 (40fps)
  → FixedUpdateの実行頻度を下げる（精度とのトレードオフ）
```

Auto Simulationをオフにした場合は、以下のように手動で物理演算を実行します。

```csharp
void FixedUpdate()
{
    // 必要な前処理
    Physics.Simulate(Time.fixedDeltaTime);
    // 必要な後処理
}
```

これにより、物理演算のタイミングを完全に制御でき、不要なフレームでの実行を回避できます。

## DOTS/ECSによる大規模物理シミュレーション

Unity DOTS（Entities 1.4、Physics 1.0.16）は、従来のGameObject/MonoBehaviourとは異なるアーキテクチャで、**5〜50倍のCPU性能向上**を実現します。

### DOTS Physicsの特徴

- **完全にC#で記述された決定論的な剛体物理エンジン**
- **Job SystemとBurst Compilerによる並列化**
- **Havok Physics for Unityにも対応**（AAA品質が必要な場合）

### EntityとComponentの定義

```csharp
using Unity.Entities;
using Unity.Mathematics;

public struct PhysicsVelocity : IComponentData
{
    public float3 Linear;
    public float3 Angular;
}

public struct PhysicsMass : IComponentData
{
    public float InverseMass;
    public float3 InverseInertia;
}

public struct PhysicsGravityFactor : IComponentData
{
    public float Value;
}
```

### Systemによる物理演算処理

```csharp
using Unity.Entities;
using Unity.Jobs;
using Unity.Burst;
using Unity.Mathematics;
using Unity.Transforms;

[BurstCompile]
public partial struct ApplyGravitySystem : ISystem
{
    [BurstCompile]
    public void OnUpdate(ref SystemState state)
    {
        float deltaTime = SystemAPI.Time.DeltaTime;
        float3 gravity = new float3(0, -9.81f, 0);

        var job = new ApplyGravityJob
        {
            DeltaTime = deltaTime,
            Gravity = gravity
        };

        job.ScheduleParallel();
    }
}

[BurstCompile]
public partial struct ApplyGravityJob : IJobEntity
{
    public float DeltaTime;
    public float3 Gravity;

    public void Execute(ref PhysicsVelocity velocity, in PhysicsGravityFactor gravityFactor)
    {
        velocity.Linear += Gravity * gravityFactor.Value * DeltaTime;
    }
}
```

この実装により、**10,000個のオブジェクトの重力シミュレーションがノートPCで動作する**レベルのパフォーマンスが得られます。

## IJobParallelForTransformによるTransform操作の最適化

TransformコンポーネントをJob Systemで操作する場合は専用のインターフェースを使います。

```csharp
using Unity.Jobs;
using Unity.Collections;
using UnityEngine.Jobs;
using Unity.Burst;

[BurstCompile]
public struct PositionUpdateJob : IJobParallelForTransform
{
    [ReadOnly] public NativeArray<Vector3> velocities;
    public float deltaTime;

    public void Execute(int index, TransformAccess transform)
    {
        transform.position += velocities[index] * deltaTime;
    }
}

public class TransformJobManager : MonoBehaviour
{
    private TransformAccessArray transformAccessArray;
    private NativeArray<Vector3> velocities;

    void Start()
    {
        Transform[] transforms = GetComponentsInChildren<Transform>();
        transformAccessArray = new TransformAccessArray(transforms);
        velocities = new NativeArray<Vector3>(transforms.Length, Allocator.Persistent);
    }

    void Update()
    {
        var job = new PositionUpdateJob
        {
            velocities = velocities,
            deltaTime = Time.deltaTime
        };

        JobHandle jobHandle = job.Schedule(transformAccessArray);
        jobHandle.Complete();
    }

    void OnDestroy()
    {
        transformAccessArray.Dispose();
        velocities.Dispose();
    }
}
```

**TransformAccessArray**はTransformへの並列アクセスを安全に行うための仕組みで、300エージェントで18ms→0.47msの劇的な改善が可能です。

## まとめ：Unity物理演算最適化のチェックリスト

- **Physics Settings最適化**: Auto Simulation/Auto Sync Transformsをオフ、Fixed Timestepを調整
- **Job System導入**: IJobParallelForで並列処理、Burst Compilerで高速化
- **DOTS/ECS移行**: 大規模シミュレーションでは5〜50倍の性能向上
- **NativeContainerの適切な管理**: Allocator.Persistentでメモリリーク防止、必ずDispose()
- **TransformAccessArray**: Transform操作はIJobParallelForTransformを使う
- **プロファイリング**: Unity Profilerで実測し、ボトルネックを特定してから最適化

2026年現在、Unity 6.2とEntities 1.4の組み合わせにより、モバイルからPCまで幅広いプラットフォームで高性能な物理演算が実現可能です。段階的に導入し、プロファイラで効果を確認しながら進めましょう。

---

**Sources:**
- [Unity 最適化１](https://zenn.dev/nakaigames/articles/086eaaf1361484)
- [Unity2021～2022（&Unity6）で考える最適化テクニック #C# - Qiita](https://qiita.com/waiwaiunity/items/55038fa546ad16ec360b)
- [Unity - Manual: Write multithreaded code with the job system](https://docs.unity3d.com/Manual/job-system.html)
- [Improve Performance with C# Job System and Burst Compiler in Unity | by Eric Hu | Medium](https://realerichu.medium.com/improve-performance-with-c-job-system-and-burst-compiler-in-unity-eecd2a69dbc8)
- [Unity DOTS / ECS Performance: Amazing | by Anton Antich | Superstring Theory | Medium](https://medium.com/superstringtheory/unity-dots-ecs-performance-amazing-5a62fece23d4)
- [ECS for Unity](https://unity.com/ecs)
- [Unity - Manual: Job system overview](https://docs.unity3d.com/6000.2/Documentation/Manual/job-system-overview.html)