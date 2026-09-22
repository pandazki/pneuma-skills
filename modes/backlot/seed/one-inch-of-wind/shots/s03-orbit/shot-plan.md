# 03 绕阵交锋

第二轮分镜 · 待联合分镜确认

## 意图与关联
绕阵交锋；场景 sc1，人物 keeper/challenger，场地 courtyard。

## 空间
坐标沿用 bible/design.md：+X 东、+Y 北，石台直径8m、高0.15m；北阶8级、每级0.15m，顶端(0,8.4,1.2)；西断廊X=-9，钟楼(8,7)，大树(9,-6)。两人身高1.78/1.80m，剑刃0.78m。所有镜头共用庭院和人物轨迹，禁止逐镜挪动地标。

## 时间与构图
源片6秒，24fps，共144帧；854×480。C由(0,3)到(0,1.7)，试探后退到(-0.3,2.3)；K固定(0,0)只转向。2秒接触后才有剑光或碰击。

| 本地成片时钟/秒 | 节拍 | 归属 | detail / 画面设计 |
|---|---|---|---|
| 0–1.5 | 短步逼近 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Briskly, the challenger advances 1.3 metres with weighted steps, brows drawn; the keeper tracks him calmly, pale robe turning without retreat. |
| 1.5–2 | 斜劈试探 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | In a sudden burst the challenger cuts diagonally; the keeper raises a compact parry, eyes on the blade, sleeves snapping after the wrists. |
| 2–2.5 | 触锋拨开 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | On blade contact at 2.0 seconds, the keeper turns the edge aside; a brief steel glint follows impact, the challenger recoil visibly checked. |
| 2.5–4.5 | 收剑换线 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | At measured speed the challenger recoils half a step and shifts northwest, drawing his blade to his ribs; his sash swings then falls. |
| 4.5–6 | 沉肩蓄杀 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Slowly he sinks into a loaded stance screen left, jaw set; the keeper waits screen right, sword low, both feet grounded and blades apart. |
| 0–6 | 单一机位 | blocked：机位 | One continuous 240-degree orbit ends west of both fighters in a settled wide two-shot; no cut. |

## 相机
单一240°环绕：共同中心(0,1.5)，半径6.5m、高2.4m，32mm；绝对角-60°→180°，0–5.5秒连续旋转、两端缓动，5.5–6秒停住，终点(-6.5,1.5,2.4)，朝(0,1.2,1.0)。这是已批准的迅疾大环绕，不改成慢40°环绕；需逐帧检查北阶上方净空、残柱遮挡和双人始终可辨。

分镜图选本地5.5秒。图像参考只提供外观；准确尺度与相机在白模复核。每镜一段连续镜头，不允许模型自行切镜，no music。

## 入点
Challenger at (0,3,0.15), facing south toward the offscreen keeper, upright after landing, right-hand sword lowered, feet planted; keeper at (0,0,0.15), facing north, sword lowered; three metres apart, dust settled, no contact.

## 剪辑出点
Challenger screen left at (-0.3,2.3,0.15), facing the keeper, right foot behind, weight loaded, right-hand sword chambered beside ribs; keeper screen right at (0,0,0.15), facing challenger, sword low, calm; blades separated.

## 切点决策
continuous action；同一动作持续发生，只换机位，无时间省略。entry逐字取自上一镜使用区间的exit，声明continuity并按顺序生成、选择take。

## 因果与验收
脚触地先于尘；剑接触先于拨偏／剑光；停锋先于垂剑；见垂剑后才收锋。每把剑只一柄，剑鞘不可变第二武器。切点复核脚位、重心、朝向、剑位、衣摆惯性及尘的位置；过轴只允许03连续环绕，04–06全在X<0。

## 时钟与白模实施约定
所有上表秒数为shot clock。白模以动作时钟建轨，slowmo后用shot_time/action_time对照这些既定拍点；源片终点不得吞掉垂剑或停驻。04–06调用同一杀招主轨，用显式offset 0/1/2秒转换本地时钟；不是各写一套动作。慢放和impact也在主时钟定义再转换，禁止分别压缩三个角度的动作。白模是无四肢的有朝向棋子；手腕、劈刺、脸部仅acted，白模负责位移、触点和安全停锋标记。

## 假设
沿用原剧本36秒源片／30秒成片、24fps、480p、服装与场景；第二轮新预算$20覆盖本轮增量，不重算已发生设定费。机位坐标和微观拍点是本轮待批准设计，白模验证前不宣称空间或动画验收通过。
