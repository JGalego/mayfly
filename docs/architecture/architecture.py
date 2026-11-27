"""Mayfly's architecture, drawn with each component's logo. Run `pixi run diagram` after changing it."""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.generic.device import Mobile
from diagrams.onprem.auth import Oauth2Proxy
from diagrams.onprem.client import Client
from diagrams.onprem.identity import Dex

HERE = Path(__file__).parent

GRAPH = {"fontname": "Helvetica", "pad": "0.8", "nodesep": "0.7", "ranksep": "1.1", "splines": "spline"}
NODE = {"fontname": "Helvetica", "fontsize": "13"}
EDGE = {"fontname": "Helvetica", "fontsize": "11", "color": "#6b7280", "fontcolor": "#374151"}
TAILNET = {"color": "#4b5563", "style": "dashed"}
# Labels under icons are wider than the icons, and Graphviz sizes a box by the icons alone: the margin keeps the labels inside.
BOX = {"fontname": "Helvetica", "fontsize": "13", "margin": "30"}


def logo(name: str) -> str:
    return str(HERE / "logos" / f"{name}.png")


def label(name: str, what: str = "") -> str:
    """A node's name in bold, and what it does under it. The newline makes room: diagrams counts them to size a node."""
    return f"<<b>{name}</b>" + (f"<br/>\n{what}" if what else "") + ">"


with Diagram("", filename=str(HERE / "architecture"), outformat="png", show=False, direction="LR", graph_attr=GRAPH, node_attr=NODE, edge_attr=EDGE):
    phone = Mobile(label("Your phone", "and people you share with"))
    model = Custom(label("Model provider", "OpenAI-compatible"), logo("openai"))

    with Cluster("Your computer", graph_attr=BOX):
        browser = Client(label("Your browser"))
        serve = Custom(label("Tailscale Serve", "HTTPS on your tailnet"), logo("tailscale"))

        with Cluster("Podman Desktop", graph_attr=BOX):
            mayfly = Custom(label("Mayfly extension"), logo("mayfly"))

        with Cluster("Podman", graph_attr=BOX):
            podman = Custom(label("Podman", "builds and runs"), logo("podman"))

            with Cluster("One pod per app", graph_attr=BOX):
                # Two containers of the same image, one for each way in: drawn as one, so no lines cross.
                doors = Oauth2Proxy(label("oauth2-proxy", "a door per way in"))
                app = Custom(label("Generated app", "Hono, on the runtime"), logo("hono"))

            with Cluster("Sign-in", graph_attr=BOX):
                dex = Dex(label("Dex"))
                sessions = Custom(label("Sessions", "on a volume"), logo("sqlite"))

    mayfly >> Edge(label="what you ask,\nthe app's code") >> model
    mayfly >> Edge(label="routes.ts") >> podman
    browser >> Edge(label="127.0.0.1") >> doors
    phone >> Edge(label="tailnet", **TAILNET) >> serve >> Edge(**TAILNET) >> doors
    doors >> Edge(label="identity headers") >> app
    doors >> Edge(label="OIDC") >> dex
    dex >> sessions
