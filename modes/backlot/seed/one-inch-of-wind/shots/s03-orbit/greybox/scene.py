import pathlib, sys, os
HERE=pathlib.Path(__file__).resolve()
PROJECT=HERE.parents[3]
sys.path.insert(0,str(PROJECT / "production-r2" / "previz"))
from build_scene import make
make(3,HERE.parent.parent,layout=os.environ.get("PREVIZ_LAYOUT_ONLY")=="1")
