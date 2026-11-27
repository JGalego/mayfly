"""Mayfly's architecture, drawn with each component's logo. Run `pixi run diagram` after changing it."""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.generic.device import Mobile
from diagrams.onprem.auth import Oauth2Proxy
from diagrams.onprem.client import Client
from diagrams.onprem.identity import Dex

HERE = Path(__file__).parent

GRAPH = {"fontname": "Helvetica", "pad": "0.4", "nodesep": "0.7", "ranksep": "1.1", "splines": "spline"}
NODE = {"fontname": "Helvetica", "fontsize": "13"}
EDGE = {"fontname": "Helvetica", "fontsize": "11", "color": "#6b7280", "fontcolor": "#374151"}
TAILNET = {"color": "#4b5563", "style": "dashed"}
# Labels under icons are wider than the icons, and Graphviz sizes a box by the icons alone: the margin keeps the labels inside.
BOX = {"fontname": "Helvetica", "fontsize": "13", "margin": "30"}


def logo(name: str) -> str:
    return str(HERE / "logos" / f"{name}.png")


with Diagram("", filename=str(HERE / "architecture"), outformat="png", show=False, direction="LR", graph_attr=GRAPH, node_attr=NODE, edge_attr=EDGE):
    phone = Mobile("Your phone, and\npeople you share with")
    model = Custom("Model provider\nOpenAI-compatible", logo("openai"))

    with Cluster("Your computer", graph_attr=BOX):
        browser = Client("Your browser")
        serve = Custom("Tailscale Serve\nHTTPS on your tailnet", logo("tailscale"))

        with Cluster("Podman Desktop", graph_attr=BOX):
            mayfly = Custom("Mayfly extension", logo("mayfly"))

        with Cluster("Podman", graph_attr=BOX):
            podman = Custom("Podman\nbuilds and runs", logo("podman"))

            with Cluster("One pod per app", graph_attr=BOX):
                # Two containers of the same image, one for each way in: drawn as one, so no lines cross.
                doors = Oauth2Proxy("oauth2-proxy\na door per way in")
                app = Custom("Generated app\nHono, on the runtime", logo("hono"))

            with Cluster("Sign-in", graph_attr=BOX):
                dex = Dex("Dex")
                sessions = Custom("Sessions\non a volume", logo("sqlite"))

    mayfly >> Edge(label="what you ask,\nthe app's code") >> model
    mayfly >> Edge(label="routes.ts") >> podman
    browser >> Edge(label="127.0.0.1") >> doors
    phone >> Edge(label="tailnet", **TAILNET) >> serve >> Edge(**TAILNET) >> doors
    doors >> Edge(label="identity headers") >> app
    doors >> Edge(label="OIDC") >> dex
    dex >> sessions
