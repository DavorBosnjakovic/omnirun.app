import { getUser, supabaseAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const user = await getUser(req);
  if (!user) {
    return errorResponse("Unauthorized", 401);
  }

  const { device_id } = await req.json();
  if (!device_id) {
    return errorResponse("Missing device_id");
  }

  try {
    // Get device — only allow waking your own devices
    const { data: device, error: devError } = await supabaseAdmin
      .from("devices")
      .select(
        "id, device_name, mac_address, wake_method, wol_enabled, wol_broadcast_ip, wol_public_ip, wol_public_port, is_online"
      )
      .eq("id", device_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (devError || !device) {
      return errorResponse("Device not found", 404);
    }

    if (device.is_online) {
      return jsonResponse({
        success: true,
        message: "Device is already online",
        already_online: true,
      });
    }

    if (!device.wol_enabled) {
      return errorResponse(
        "Wake-on-LAN is not enabled for this device. Enable it in desktop app Settings → Remote Access."
      );
    }

    if (!device.mac_address) {
      return errorResponse(
        "No MAC address configured. Complete WoL setup in the desktop app first."
      );
    }

    // Determine target for the mobile app to use
    let targetHost: string;
    let targetPort: number;
    let wakeMethod: string;

    if (device.wake_method === "wol_port_forward") {
      if (!device.wol_public_ip || !device.wol_public_port) {
        return errorResponse(
          "Port forwarding not configured. Set public IP and port in desktop app Settings → Remote Access."
        );
      }
      targetHost = device.wol_public_ip;
      targetPort = device.wol_public_port;
      wakeMethod = "wol_port_forward";
    } else {
      if (!device.wol_broadcast_ip) {
        return errorResponse(
          "Broadcast IP not configured. Complete WoL setup in the desktop app first."
        );
      }
      targetHost = device.wol_broadcast_ip;
      targetPort = 9;
      wakeMethod = "wol_local";
    }

    // Log the wake command
    await supabaseAdmin.from("remote_commands").insert({
      user_id: user.id,
      device_id: device.id,
      command: "wake",
      status: "sent",
      payload: {
        wake_method: wakeMethod,
        target: `${targetHost}:${targetPort}`,
        mac_address: device.mac_address,
      },
    });

    // Return device info so mobile app can send the UDP packet itself
    return jsonResponse({
      success: true,
      message: `Wake command logged for ${device.device_name}`,
      wake_data: {
        mac_address: device.mac_address,
        wake_method: wakeMethod,
        target_host: targetHost,
        target_port: targetPort,
      },
    });
  } catch (err) {
    console.error("Error processing wake command:", err);
    return errorResponse("Failed to process wake command", 500);
  }
});