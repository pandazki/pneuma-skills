# 07 高处余风

第二轮分镜 · 待联合分镜确认

## 意图与关联
高处余风；场景 sc1，人物 keeper/challenger，场地 courtyard。

## 空间
坐标沿用 bible/design.md：+X 东、+Y 北，石台直径8m、高0.15m；北阶8级、每级0.15m，顶端(0,8.4,1.2)；西断廊X=-9，钟楼(8,7)，大树(9,-6)。两人身高1.78/1.80m，剑刃0.78m。所有镜头共用庭院和人物轨迹，禁止逐镜挪动地标。

## 时间与构图
源片6秒，24fps，共144帧；854×480。唯一旁白于本地1秒起：「胜负，只在一寸之间。」kind=vo；复用设定的声音身份，声音站制作并检查。

| 本地成片时钟/秒 | 节拍 | 归属 | detail / 画面设计 |
|---|---|---|---|
| 0–1 | 见垂剑后收锋 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Only after seeing the lowered opponent sword, the keeper slowly withdraws his tip and lowers his blade; challenger exhales, shoulders easing, no foot movement. |
| 1–4.5 | 风回庭院 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | In calm stillness both swords stay lowered, faces soften and robes settle; flags resume their gentle motion while the men recede into the courtyard. |
| 4.5–6 | 高处留白 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Hold a quiet wide ending, two small grounded figures beneath the dusk mountains; flags and leaves move gently, no new action or on-screen text. |
| 0–6 | 单一机位 | blocked：机位 | One continuous crane rising backward ends still on the whole courtyard, fixed focal length; one continuous shot, no cut. |

## 相机
单一直线升降臂后撤：28mm固定焦距，相机(-3.6,-2.8,2.5)→(-9,-11,11)，目标(0,0,0.8)，0–5.5秒平滑升高后撤，最后0.5秒停稳，结束为包含北阶、钟楼、大树和远山的庭院全景；禁止另加变焦。

分镜图选本地5.5秒。图像参考只提供外观；准确尺度与相机在白模复核。每镜一段连续镜头，不允许模型自行切镜，no music。

## 入点
Challenger at (-0.3,-0.45,0.15), facing south, shoulders rigid, right-hand sword lowered beside thigh; keeper at (0.35,0,0.15), turned southwest, sword tip stationary 3 cm from challenger side neck; shoulders staggered, feet planted, no wound, cloth settled.

## 剪辑出点
Both fighters remain on their final marks, challenger sword lowered and keeper sword withdrawn down to his right side, shoulders relaxed, no contact; the whole courtyard is visible and flags move in the wind.

## 切点决策
continuous action；同一动作持续发生，只换机位，无时间省略。entry逐字取自上一镜使用区间的exit，声明continuity并按顺序生成、选择take。

## 因果与验收
脚触地先于尘；剑接触先于拨偏／剑光；停锋先于垂剑；见垂剑后才收锋。每把剑只一柄，剑鞘不可变第二武器。切点复核脚位、重心、朝向、剑位、衣摆惯性及尘的位置；过轴只允许03连续环绕，04–06全在X<0。

## 时钟与白模实施约定
所有上表秒数为shot clock。白模以动作时钟建轨，slowmo后用shot_time/action_time对照这些既定拍点；源片终点不得吞掉垂剑或停驻。04–06调用同一杀招主轨，用显式offset 0/1/2秒转换本地时钟；不是各写一套动作。慢放和impact也在主时钟定义再转换，禁止分别压缩三个角度的动作。白模是无四肢的有朝向棋子；手腕、劈刺、脸部仅acted，白模负责位移、触点和安全停锋标记。

## 假设
沿用原剧本36秒源片／30秒成片、24fps、480p、服装与场景；第二轮新预算$20覆盖本轮增量，不重算已发生设定费。机位坐标和微观拍点是本轮待批准设计，白模验证前不宣称空间或动画验收通过。

## 白模实现校正（本次联合评审）

白模验证后取景校正：26mm固定焦距，机位(-2,-5,2.5)→(-7,-15,12)，目标(0,0,0.8)→(0,2,3)，5.5秒停稳。保留单一升高后撤，结尾钟楼和山势进入画面。 动作、节拍、trim与承接状态保持已批准版本。
