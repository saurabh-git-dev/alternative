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

/// Copy a file into the phone's shared Downloads folder (Download/Tools),
/// where the Files app and other apps see it. Uses MediaStore, which needs
/// no storage permission (Android 10 and newer). Returns where it went.
pub fn save_to_downloads(path: &std::path::Path, name: &str, mime: &str) -> Result<String, String> {
    use std::os::fd::FromRawFd;

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let sdk = env
        .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")
        .and_then(|v| v.i())
        .map_err(|e| e.to_string())?;
    if sdk < 29 {
        return Err("Saving to Downloads needs Android 10 or newer.".into());
    }
    let result = (|| -> jni::errors::Result<(i32, JObject<'_>, JObject<'_>)> {
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        let resolver = env.call_method(&context, "getContentResolver", "()Landroid/content/ContentResolver;", &[])?.l()?;
        let values = env.new_object("android/content/ContentValues", "()V", &[])?;
        for (key, value) in [("_display_name", name), ("mime_type", mime), ("relative_path", "Download/Tools")] {
            let key = env.new_string(key)?;
            let value = env.new_string(value)?;
            env.call_method(&values, "put", "(Ljava/lang/String;Ljava/lang/String;)V", &[(&key).into(), (&value).into()])?;
        }
        put_int(&mut env, &values, "is_pending", 1)?;
        let collection = env
            .get_static_field("android/provider/MediaStore$Downloads", "EXTERNAL_CONTENT_URI", "Landroid/net/Uri;")?
            .l()?;
        let uri = env
            .call_method(&resolver, "insert", "(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;", &[(&collection).into(), (&values).into()])?
            .l()?;
        let mode = env.new_string("w")?;
        let pfd = env
            .call_method(&resolver, "openFileDescriptor", "(Landroid/net/Uri;Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;", &[(&uri).into(), (&mode).into()])?
            .l()?;
        let fd = env.call_method(&pfd, "detachFd", "()I", &[])?.i()?;
        Ok((fd, resolver, uri))
    })();
    let (fd, resolver, uri) = match result {
        Ok(r) if !r.2.is_null() => r,
        Ok(_) => return Err("Android didn't make the file in Downloads.".into()),
        Err(e) => {
            let _ = env.exception_clear();
            return Err(format!("Couldn't save to Downloads: {e}"));
        }
    };
    // The fd is ours now (detached from Java): write the file through it.
    let copied = {
        let mut out = unsafe { std::fs::File::from_raw_fd(fd) };
        std::fs::File::open(path).and_then(|mut input| std::io::copy(&mut input, &mut out)).and_then(|_| out.sync_all())
    };
    let finish = (|| -> jni::errors::Result<()> {
        if copied.is_ok() {
            let values = env.new_object("android/content/ContentValues", "()V", &[])?;
            put_int(&mut env, &values, "is_pending", 0)?;
            env.call_method(
                &resolver,
                "update",
                "(Landroid/net/Uri;Landroid/content/ContentValues;Ljava/lang/String;[Ljava/lang/String;)I",
                &[(&uri).into(), (&values).into(), (&JObject::null()).into(), (&JObject::null()).into()],
            )?;
        } else {
            env.call_method(
                &resolver,
                "delete",
                "(Landroid/net/Uri;Ljava/lang/String;[Ljava/lang/String;)I",
                &[(&uri).into(), (&JObject::null()).into(), (&JObject::null()).into()],
            )?;
        }
        Ok(())
    })();
    if finish.is_err() {
        let _ = env.exception_clear();
    }
    copied.map_err(|e| format!("Couldn't save to Downloads: {e}"))?;
    finish.map_err(|e| format!("Couldn't save to Downloads: {e}"))?;
    Ok(format!("Download/Tools/{name}"))
}

fn put_int(env: &mut jni::JNIEnv<'_>, values: &JObject<'_>, key: &str, value: i32) -> jni::errors::Result<()> {
    let key = env.new_string(key)?;
    let boxed = env.call_static_method("java/lang/Integer", "valueOf", "(I)Ljava/lang/Integer;", &[value.into()])?.l()?;
    env.call_method(values, "put", "(Ljava/lang/String;Ljava/lang/Integer;)V", &[(&key).into(), (&boxed).into()])?;
    Ok(())
}

/// The app's private files folder (`Context.getFilesDir()`).
pub fn files_dir() -> Option<std::path::PathBuf> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let result = (|| -> jni::errors::Result<String> {
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        let dir = env.call_method(&context, "getFilesDir", "()Ljava/io/File;", &[])?.l()?;
        let path = env.call_method(&dir, "getAbsolutePath", "()Ljava/lang/String;", &[])?.l()?;
        Ok(env.get_string(&path.into())?.into())
    })();
    match result {
        Ok(p) => Some(p.into()),
        Err(_) => {
            let _ = env.exception_clear();
            None
        }
    }
}
