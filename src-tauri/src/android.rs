//! Android-only glue.

use jni::{objects::JObject, JavaVM};

/// Android drops multicast packets for apps that don't hold a Wi-Fi
/// multicast lock, which would hide LocalSend announcements. Held for the
/// app's lifetime (needs CHANGE_WIFI_MULTICAST_STATE).
pub fn multicast_lock() {
    if let Err(e) = try_multicast_lock() {
        eprintln!("local share: no multicast lock: {e}");
    }
}

fn try_multicast_lock() -> jni::errors::Result<()> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    let name = env.new_string("wifi")?;
    let wifi = env.call_method(&context, "getSystemService", "(Ljava/lang/String;)Ljava/lang/Object;", &[(&name).into()])?.l()?;
    let tag = env.new_string("tools-local-share")?;
    let lock = env
        .call_method(&wifi, "createMulticastLock", "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;", &[(&tag).into()])?
        .l()?;
    env.call_method(&lock, "setReferenceCounted", "(Z)V", &[false.into()])?;
    env.call_method(&lock, "acquire", "()V", &[])?;
    // Keep the lock alive for as long as the app runs.
    std::mem::forget(env.new_global_ref(lock)?);
    Ok(())
}
