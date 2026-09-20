# 04 杀招·起

第二轮分镜 · 待联合分镜确认

## 意图与关联
杀招·起；场景 sc1，人物 keeper/challenger，场地 courtyard。

## 空间
坐标沿用 bible/design.md：+X 东、+Y 北，石台直径8m、高0.15m；北阶8级、每级0.15m，顶端(0,8.4,1.2)；西断廊X=-9，钟楼(8,7)，大树(9,-6)。两人身高1.78/1.80m，剑刃0.78m。所有镜头共用庭院和人物轨迹，禁止逐镜挪动地标。

## 时间与构图
源片4秒，24fps，共96帧；854×480。取本地[0,1)秒；完整源片继续同一杀招，不回到起势。登记exit指剪辑出点1秒的状态，非废弃源尾4秒。

| 本地成片时钟/秒 | 节拍 | 归属 | detail / 画面设计 |
|---|---|---|---|
| 0–1 | 贴台疾进 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | In a sharp burst the challenger drives off his rear foot, left foot reaching forward, sword tight to ribs; red sash snaps behind, eyes narrowed. |
| 1–2 | 送锋逼近 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Accelerating from the planted left foot, he sends the blade toward the upper chest; the keeper calmly slides east and lifts his blade, sleeves trailing. |
| 2–2.5 | 触锋慢放 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | At 2.0 seconds the blades meet; in slow motion the keeper redirects the thrust, steel glint following contact, suspended dust and taut faces readable. |
| 2.5–2.75 | 骤快错身 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | In a sudden release of speed the thrust skims past; the challenger passes the keeper shoulder, coat whipping, surprise entering his eyes. |
| 2.75–3 | 一寸停锋 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | In slow motion the keeper checks his returning blade exactly three centimetres from the side neck; challenger freezes wide-eyed, cloth still travelling, no injury. |
| 3–4 | 垂剑认输 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | With the tip held absolutely still, the challenger slowly lowers his sword to his thigh, jaw unclenching; robe and sash settle after his body stops. |
| 0–4 | 单一机位 | blocked：机位 | Locked-off oblique wide shot, both bodies and path visible through the final frame; one continuous shot, no cut. |

## 相机
锁定机位(-5.5,3.8,1.5)，28mm，目标(0,1.0,1.0)；西侧斜广角，全身与推进路径完整；4秒全程锁定，不在镜内切到低机位。

分镜图选本地0.5秒。图像参考只提供外观；准确尺度与相机在白模复核。每镜一段连续镜头，不允许模型自行切镜，no music。

## 入点
Challenger screen left at (-0.3,2.3,0.15), facing the keeper, right foot behind, weight loaded, right-hand sword chambered beside ribs; keeper screen right at (0,0,0.15), facing challenger, sword low, calm; blades separated.

## 剪辑出点
Challenger screen left at (-0.15,1.3,0.15), facing screen right toward keeper, left foot just planted, right heel lifted, sword still chambered beside ribs; keeper screen right at (0,0,0.15), sword low; sash trails screen left, no blade contact.

## 切点决策
continuous action；同一动作持续发生，只换机位，无时间省略。entry逐字取自上一镜使用区间的exit，声明continuity并按顺序生成、选择take。

## 因果与验收
脚触地先于尘；剑接触先于拨偏／剑光；停锋先于垂剑；见垂剑后才收锋。每把剑只一柄，剑鞘不可变第二武器。切点复核脚位、重心、朝向、剑位、衣摆惯性及尘的位置；过轴只允许03连续环绕，04–06全在X<0。

## 时钟与白模实施约定
所有上表秒数为shot clock。白模以动作时钟建轨，slowmo后用shot_time/action_time对照这些既定拍点；源片终点不得吞掉垂剑或停驻。04–06调用同一杀招主轨，用显式offset 0/1/2秒转换本地时钟；不是各写一套动作。慢放和impact也在主时钟定义再转换，禁止分别压缩三个角度的动作。白模是无四肢的有朝向棋子；手腕、劈刺、脸部仅acted，白模负责位移、触点和安全停锋标记。

## 假设
沿用原剧本36秒源片／30秒成片、24fps、480p、服装与场景；第二轮新预算$20覆盖本轮增量，不重算已发生设定费。机位坐标和微观拍点是本轮待批准设计，白模验证前不宣称空间或动画验收通过。
